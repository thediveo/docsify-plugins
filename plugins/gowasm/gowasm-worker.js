// Copyright 2026 Harald Albrecht.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

importScripts('wasm_exec.js')

const decoder = new TextDecoder('utf-8')

// wasm_exec.js installs a global "fs" object with various file system
// functions, especially the writeSync method we're interested in. In order to
// fall back onto it where needed, we save the original function.
const fsWriteSync = globalThis.fs.writeSync

// We're now hooking into the file system output function, dealing with stdin
// (fd #1) and stdout (fd #2) especially: we send output to these file
// descriptors not to the original write function (which does send it to
// console.log and console.err respectively) but instead to "the other" side,
// where hopefully our nice xterm.js is still waiting...
globalThis.fs.writeSync = function (fd, buf) {
    switch (fd) {
        case 1:
        case 2:
            globalThis.postMessage({
                type: fd === 1 ? 'stdout' : 'stderr',
                data: decoder.decode(buf),
            })
            return buf.length // don't chain
        default:
            return fsWriteSync(fd, buf)
    }
}

// We only expect to get a single initial message which tells us the details we
// need in order to start the correct wasm binary with proper arguments (if
// any).
globalThis.onmessage = async (e) => {

    const { wasm, args } = e.data

    const go = new Go()
    go.argv = [wasm, ...args]

    // Try to fetch and stream the specified wasm file; if the server correctly
    // handles "Content-Encoding: gzip" with "Content-Type: application/wasm"
    // then we should be fine in this first attempt, unless that hits the wall.
    try {
        const result = await WebAssembly.instantiateStreaming(fetch(wasm), go.importObject)
        await go.run(result.instance)
        globalThis.postMessage({ type: 'done' })
    } catch (err) {
        // Try again, this time with explicit .wasm.gz fetch and see if we're
        // going to be lucky. The downside is that we need to decompress
        // explicitly before we can instantiate, but that's a price to pay for
        // transparent handling of especially the bare-bones docsify-cli server.
        try {
            const res = await fetch(wasm + ".gz");
            const compressed = await res.arrayBuffer();

            const ds = new DecompressionStream("gzip");
            const stream = new Blob([compressed]).stream().pipeThrough(ds);
            const buffer = await new Response(stream).arrayBuffer();

            const result = await WebAssembly.instantiate(buffer, go.importObject);
            await go.run(result.instance)
            globalThis.postMessage({ type: 'done' })
        } catch (gzerr) {
            globalThis.postMessage({
                type: 'error',
                data: 'first error:\n' + err.toString() + '\nsecond error:\n' + gzerr.toString(),
            })
        }
    }
}
