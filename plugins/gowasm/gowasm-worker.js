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

    // fdtable maps fd numbers to {path, data, pos}
    const fdtable = new Map()

    const allocfd = () => {
        if (fdtable.size >= max_open_fds) {
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

    const sanitizedPath = (path) => {
        path = String(path)
        path = path.replace(/\\/g, '/')

        const element = path.split('/')
        const elements = []

        for (const part of element) {
            if (part === '' || part === '.') {
                continue;
            }
            if (part === '..') {
                if (elements.length === 0) {
                    // cannot escape root
                    continue
                }
                elements.pop()
            } else {
                elements.push(part)
            }
        }
        return elements.join('/')
    }

    const fetchFile = async (path) => {
        console.log("loading file...", path)
        if (files.has(path)) {
            return files.get(path)
        }
        const url = new URL(sanitizedPath(path), baseURL)
        console.log("fetching url...", url)
        const result = await fetch(url)
        if (!result.ok) {
            throw enoent()
        }
        const data = new Uint8Array(await result.arrayBuffer())
        files.set(path, data)
        console.log("loaded file", path)
        return data
    }

    const statinfo = (size, isDir) => {
        const now = Date.now()
        return {
            dev: 0,
            ino: 0,
            mode: isDir ? 0o555 : 0o444,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: size,
            blksize: 4096,
            blocks: Math.ceil(size / 4096),

            atimeMs: now,
            mtimeMs: now,
            ctimeMs: now,
            birthtimeMs: now,

            atime: new Date(now),
            mtime: new Date(now),
            ctime: new Date(now),
            birthtime: new Date(now),

            isFile: () => !isDir,
            isDirectory: () => isDir,
            isSymbolicLink: () => false,
        }
    }

    globalThis.fs.stat = (path, callback) => {
        (async (path) => {
            console.log("stating file...", path)
            const gomagicpath = 'usr/local/go'
            if (path === gomagicpath || path.startsWith(gomagicpath + '/')) {
                const elements = path.split("/")
                if (elements.length > 0 && !elements[elements.length - 1].includes('.')) {
                    callback(null, statinfo(10000, true))
                    return
                }
            }
            try {
                const data = await fetchFile(path)
                console.log("stat'd file", path)
                callback(null, statinfo(data.length, false))
            } catch (err) {
                console.log("stat err", err)
                callback(err)
                return
            }
        })(sanitizedPath(path))
    }

    globalThis.fs.open = (path, flags, _, callback) => {
        (async (path) => {
            try {
                console.log("opening file...", path)
                if (flags & ~O_CLOEXEC) {
                    throw eacces()
                }
                const data = await fetchFile(path)
                const fd = allocfd()
                fdtable.set(fd, {
                    path: path,
                    data: data,
                    pos: 0,
                })
                console.log("opened file", path)
                callback(null, fd)
            } catch (err) {
                console.log("open err", err)
                callback(err)
                return
            }
        })(sanitizedPath(path))
    }

    globalThis.fs.close = (fd, callback) => {
        console.log("closing file", fd)
        if (!fdtable.delete(fd)) {
            callback(ebadf())
            return
        }
        callback(null)
    }

    globalThis.fs.read = (fd, buffer, offset, length, position, callback) => {
        console.log("reading file", fd)
        const f = fdtable.get(fd)
        if (!f) {
            callback(ebadf())
            return
        }
        const data = f.data
        const pos = Math.min(Math.max(0, position !== null ? position : f.pos), data.length)
        const region = data.subarray(pos, Math.min(pos + length, data.length))
        buffer.set(region, offset)
        if (position === null) {
            f.pos = pos + region.length
        }
        callback(null, region.length)
    }

    globalThis.fs.readdir = (path, callback) => {
        console.log("reading dir", path)
        callback(null, ebadf())
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
