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
const first_available_fd = 3

// inode file types, from Go's syscall_js.go; see:
// https://github.com/golang/go/blob/9c8bf0e72a6fb3b415b591b124b59fbb7cf92252/src/syscall/syscall_js.go#L177
const S_IFREG = 0o0000100000
const S_IFDIR = 0o0000040000

const decoder = new TextDecoder('utf-8')

// We only expect to get a single initial message which tells us the details we
// need in order to start the correct wasm binary with proper arguments (if
// any).
globalThis.onmessage = async (e) => {

    const { wasm, wasmexec, args } = e.data

    await import(wasmexec)

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
        const err = new Error("no such file or directory")
        err.code = "ENOENT"
        return err
    }

    const eacces = () => {
        const err = new Error("no access")
        err.code = "EACCES"
        return err
    }


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

    // fdtable maps fd numbers to objects with fields {path, data, pos}.
    const fdtable = new Map()

    // allocfd allocates the lowest available fd (similar to how *nixe behave),
    // but limiting the total amount of concurrently used fds to max_open_fds.
    const allocfd = () => {
        if (fdtable.size >= max_open_fds) {
            throw enfile()
        }
        for (let fd = first_available_fd; fd < first_available_fd + max_open_fds; fd++) {
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

    // fetchDir fetches the .dircontents.json for the directory specified by
    // path, and returns the array of {name, type, (size)} objects.
    const fetchDir = async (path) => {
        const url = new URL(sanitizedPath(path) + '/--dircontents.json', baseURL)
        console.log("fetching dir entries", url.toString())
        const result = await fetch(url)
        if (!result.ok) {
            throw enoent()
        }
        const direntries = await result.json()
        console.log("directory with", direntries.length, "entries")
        return direntries
    }

    const fetchFile = async (path) => {
        console.log("loading file...", path)
        if (files.has(path)) {
            return files.get(path)
        }
        const url = new URL(sanitizedPath(path), baseURL)
        console.log("fetching url...", url.toString())
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
        // https://github.com/golang/go/blob/9c8bf0e72a6fb3b415b591b124b59fbb7cf92252/src/syscall/fs_js.go#L183
        return {
            dev: 0,
            ino: 0,
            // https://github.com/golang/go/blob/9c8bf0e72a6fb3b415b591b124b59fbb7cf92252/src/syscall/syscall_js.go#L179
            mode: isDir ? (S_IFDIR | 0o555) : (S_IFREG | 0o444),
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

            isDirectory: () => isDir,
        }
    }

    // see also:
    // https://github.com/golang/go/blob/9c8bf0e72a6fb3b415b591b124b59fbb7cf92252/src/syscall/fs_js.go#L205
    globalThis.fs.stat = (path, callback) => {
        (async (path) => {
            console.log("stating file/directory...", path)
            const elements = path.split('/')
            const name = elements.pop()
            const dir = elements.join('/')
            const direntries = await fetchDir(dir)
            const match = direntries.find(direntry => direntry.name === name)

            if (match && match.type === 'directory') {
                console.log("it's a directory...", name)
                const direntries = await fetchDir(path)
                callback(null, statinfo(direntries.length * (2+256), true))
                return
            }

            try {
                const data = await fetchFile(path)
                console.log("...stat'ing as ordinary file", path)
                callback(null, statinfo(data.length, false))
            } catch (err) {
                console.log("stat err", err)
                callback(err)
                return
            }
        })(sanitizedPath(path))
    }

    // see also:
    // https://github.com/golang/go/blob/9c8bf0e72a6fb3b415b591b124b59fbb7cf92252/src/syscall/fs_js.go#L71
    globalThis.fs.open = (path, flags, _, callback) => {
        (async (path) => {
            try {
                console.log("opening file/directory...", path, "with flags", flags)
                if (flags) {
                    throw eacces()
                }
                const data = await fetchFile(path)
                const fd = allocfd()
                fdtable.set(fd, {
                    path: path,
                    data: data,
                    pos: 0,
                })
                console.log("opened file with fd", fd)
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
