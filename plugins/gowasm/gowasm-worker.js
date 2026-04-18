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

const max_open_fds = 32
const O_CLOEXEC = 0x80000

const decoder = new TextDecoder('utf-8')

// We only expect to get a single initial message which tells us the details we
// need in order to start the correct wasm binary with proper arguments (if
// any).
globalThis.onmessage = async (e) => {

    const { wasm, wasmexec, args } = e.data

    await import(wasmexec)

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

    const ebadf = () => {
        const err = new Error("bad file descriptor")
        err.code = "EBADF"
        return err
    }

    const enfile = () => {
        const err = new Error("too many open files")
        err.code = "ENFILE"
        return err
    }

    const enoent = () => {
        const err = new Error("no such file")
        err.code = "ENOENT"
        return err
    }

    const eacces = () => {
        const err = new Error("no access")
        err.code = "EACCES"
        return err
    }

    // fdtable maps fd numbers to {path, pos, data}
    const fdtable = new Map()

    const allocfd = () => {
        if (fdtable.size > max_open_fds) {
            throw enfile()
        }
        for (let fd = 3; fd < 3 + max_open_fds; fd++) {
            if (!fdtable.has(fd)) {
                return fd
            }
        }
        throw enfile()
    }

    // When retrieving files, resolve their paths relative to wasm URL, always.
    const baseURL = new URL(wasm, self.location.href)

    const files = new Map()

    const loadfile = async (path) => {
        console.log("loading file...", path)
        if (files.has(path)) {
            return files.get(path)
        }
        const result = await fetch(new URL(path, baseURL))
        if (!result.ok) {
            throw enoent()
        }
        const contents = new Uint8Array(await result.arrayBuffer())
        files.set(path, contents)
        console.log("loaded file", path)
        return contents
    }

    globalThis.fs.stat = (path, callback) => {
        (async () => {
            try {
                console.log("stating file...", path)
                const data = await loadfile(path)
                callback(null, {
                    size: data.length,
                    mode: 0o444,
                    mtime: new Date(),
                    isDirectory: () => false,
                })
            } catch (err) {
                callback(err)
                return
            }
        })()
    }

    globalThis.fs.open = (path, flags, _, callback) => {
        (async() => {
            try {
                console.log("opening file...", path)
                if (flags & ~O_CLOEXEC) {
                    throw eacces()
                }
                const data = await loadfile(path)
                const fd = allocfd()
                fdtable.set(fd, {path, pos: 0, data})
                console.log("opened file", path)
                callback(null, fd)
            } catch (err) {
                callback(err)
                return
            }
        })()
    }

    globalThis.fs.close = (fd, callback) => {
        console.log("closing file", fd)
        if (!fdtable.delete(fd)) {
            callback(ebadf())
            return
        }
        callback(null)
    }

    globalThis.fd.read = (fd, buffer, offset, length, position, callback) => {
        const f = fdtable.get(fd)
        if (!f) {
            callback(ebadf())
            return
        }
        
    }

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
