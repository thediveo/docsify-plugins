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

// A wasm plugin for docsify that HTML (<div>) elements with class
// .gowasm-terminal into live terminals rendering the terminal output of wasm
// programs executing in background workers.
//
// See also:
// https://github.com/docsifyjs/docsify/blob/develop/docs/write-a-plugin.md

// NOTE: this is an ES module, so <script type="module" ...>

"use strict";

// Some of the ANSI color sequences we (might) use...
const ANSI = {
    reset: '\x1b[0m',

    bold: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[38;5;250m',

    hide: '\x1b[?25l',
}

// The custom events that any ".gowasm-terminal" element responds to.
const gowasmCustomEvent = {
    run: 'gowasm-run',
    stop: 'gowasm-stop',
    resize: 'gowasm-resize',
}

// bunt colorizes the passed text using the additionally specified ANSI
// sequences, resetting afterwards. "bunt" means colorful in German.
const bunt = (text, ...styles) => {
    return styles.join('') + text + ANSI.reset
}

// simpleParseArgs takes a simplistic view on CLI args quoting, cutting the
// specified argument string into its pieces. If any arg is of the form "${...}"
// then "..." will be taken as a CSS selector and the matching element's text
// content used for this particular arg. For input, textarea and select
// elements, the value content is used instead of the textContent value (which
// is always empty in case of the aforementioned interactive elements).
const simpleParseArgs = (argstr) => {
    if (!argstr) return []

    // Phase I: cut into pieces, considering simplistic quoting...
    const quotesRe = /"([^"]*)"|'([^']*)'|[^\s]+/g
    const args = []
    for (let match; (match = quotesRe.exec(argstr)) !== null;) {
        args.push(match[1] ?? match[2] ?? match[0])
    }

    // Phase II: resolve anchor references, if any...
    return args.map(arg => {
        const m = arg.match(/^\$\{(.+)\}$/)
        if (!m) return arg

        const selector = m[1].trim()
        const el = globalThis.document.querySelector(selector)
        if (!el) return ''

        const hasValue =
            el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "SELECT"
        return hasValue ? el.value : el.textContent
    })
}

// parseBool returns true for "true", "on" and "1" values, otherwise the default
// value (converted to bool).
const parseBool = (val, def) => {
    if (val === undefined) return !!def
    return (val === 'true') || (val === 'on') || (val === '1')
}

// getPerWASMTerminalConfig takes the specified (global) configuration and
// overrides terminal-related configuration options if the passed element has
// the particular data-* attributes.
//
// Handling of data-args is special, as it will always set the arguments to be
// passed to the wasm program, even if left unspecified. 
const getPerWASMTerminalConfig = (config, element) => {
    return {
        ...config,
        ...Object.fromEntries(Object.entries({
            wasmexec: element.dataset.wasmexec,

            rows: element.dataset.rows && parseInt(element.dataset.rows),
            cols: element.dataset.cols && parseInt(element.dataset.cols),
            scrollback: element.dataset.scrollback && parseInt(element.dataset.scrollback),
            cursor: element.dataset.cursor,
            cursorwidth: element.dataset.cursorWidth && parseInt(element.dataset.cursorWidth),
            cursorinactive: element.dataset.cursorInactive,
            blink: element.dataset.blink && parseBool(element.dataset.blink),
        }).filter(([_, v]) => v !== undefined)
        ),
        args: element.dataset.args || '', // will be parsed into os.Args[1:]
    }
}

// create the xterm.js Terminal object and attach it to the specified
// (container) element; pass the terminal-related configuration elements to the
// Terminal constructor. The return value { term, fit } is the newly created
// Terminal object as well as a function, which when called, will resize the
// terminal to fit (again) into its container element. The fit function should
// be triggered from a debounced page (window) resize handler, or similar.
const createTerminal = async (el, config) => {
    const fontfamilies = Array.isArray(config.fontfamily)
        ? config.fontfamily.map(fam => "'" + fam + "'").join(',')
        : config.fontfamily
    // important: don't pass the font list to loadFonts so that loadFonts uses
    // the ones registered in document.fonts. Otherwise, we will hit the ground
    // with an exception from loadFonts because 'monospace' wasn't registered.
    // Ouch.
    await WebFontsAddon.loadFonts()
    const fitaddon = new FitAddon.FitAddon()
    const term = new Terminal({
        cols: config.cols,
        rows: config.rows,
        scrollback: config.scrollback,
        cursorStyle: config.cursor,
        cursorWidth: config.cursorwidth,
        cursorInactiveStyle: config.cursorinactive,
        cursorBlink: config.blink,
        fontFamily: fontfamilies,
        fontSize: config.fontsize,
        lineHeight: config.lineheight,

        convertEol: true,
    })
    el.innerHTML = ''
    term.loadAddon(new WebFontsAddon.WebFontsAddon())
    term.loadAddon(fitaddon)
    term.open(el)
    fitaddon.fit()

    return { term: term, fit: () => fitaddon.fit() }
}

// goWorker creates a new terminal including scaffolding inside the specified
// elements and then sets up custom event listeners for gowasmCustomEvent.run
// and gowasmCustomEvent.stop. Additionally, it listens to
// gowasmCustomEvent.resize and then resizes the terminal (if any).
//
// gowasmCustomEvent.run passes the specified wasm file to a separate worker,
// applying the passed element-adjusted configuration and handling sending
// output to the terminal.
//
// gowasmCustomEvent.stop stops the worker execution, if any.
//
// Calling goWorker multiple times on the same element will stop and remove any
// previous worker and recreate a new, empty terminal.
const goWorker = (wasmfile, termelement, element, config) => {
    let worker = null
    let fitterm = null

    // stop the separate worker, if any.
    const stop = (_) => {
        if (worker) {
            worker.terminate()
            worker = null
        }
    }

    // run a new separate worker after terminating any previous worker for this
    // WASM.
    const run = async (event) => {
        stop(event)

        termelement.innerHTML = ''
        const { term, fit } = await createTerminal(termelement, config)
        fitterm = fit

        if (typeof config.runmsg === 'string') {
            term.writeln(bunt(config.runmsg.replace(/\$1/g, wasmfile), ANSI.gray))
        }

        worker = new Worker(new URL('gowasm-worker.js', import.meta.url),
            { type: 'module' })
        worker.onmessage = event => {
            const msg = event.data
            switch (msg.type) {
                case 'stdout':
                    term.write(msg.data)
                    break
                case 'stderr':
                    term.write(bunt(msg.data))
                    break
                case 'error':
                    if (term.buffer.active.cursorX !== 0) {
                        term.write('\n')
                    }
                    const errormsg = (typeof config.errormsg === 'string') ? config.errormsg : ''
                    term.writeln(bunt(errormsg + '\n' + msg.data))
                    term.write(ANSI.hide)
                    break
                case 'done':
                    if (term.buffer.active.cursorX !== 0) {
                        term.write('\n')
                    }
                    if (typeof config.finishmsg === 'string') {
                        term.write(bunt(config.finishmsg))
                    }
                    term.write(ANSI.hide)
                    worker.terminate()
                    worker = null
                    break
            }
        }
        // Now tell the worker which wasm to start executing...
        worker.postMessage({
            wasm: config.wasmloc + wasmfile,
            wasmexec: config.wasmexec,
            args: simpleParseArgs(config.args),
        })
    }

    // tell the terminal to fit into its container element.
    const resize = () => {
        if (fitterm) {
            fitterm()
        }
    }

    element.addEventListener(gowasmCustomEvent.run, run)
    element.addEventListener(gowasmCustomEvent.stop, stop)
    element.addEventListener(gowasmCustomEvent.resize, resize)
}

// runWasm runs the specified wasmfile in a separate worker. For this, it
// creates a terminal inside the specified element. The passed configuration is
// applied, except for a few local data-* overrides if present.
//
// Nota bene: runWasm attaches { run, stop } functions for the separate worker
// to the specified element, as the value of element.xgowasm. This information
// is needed by the plugin lifecycle hooks to properly start and stop any wasms
// that get added or removed.
const runWasm = (wasmfile, element, globalconfig) => {
    const config = getPerWASMTerminalConfig(globalconfig, element)
    element.innerHTML = '' // completely wipe out the terminal container's contents.

    // next, we need to wrap the terminal into a container consisting of a
    // "toolbar" with the "ran again" button as well as the terminal element
    // itself. This additionally gives us better control over setting proper
    // margins, et cetera.
    const container = globalThis.document.createElement('div')
    const toolbar = globalThis.document.createElement('div')
    const terminal = globalThis.document.createElement('div')

    toolbar.style.display = 'flex'
    toolbar.style.justifyContent = 'flex-end'
    toolbar.style.marginBottom = '4px'

    // add the "Run again" button to the "toolbar".
    const runbutton = globalThis.document.createElement('button')
    runbutton.className = 'wasm-runagain'
    runbutton.textContent = config.runbutton
    toolbar.appendChild(runbutton)

    container.appendChild(toolbar)
    container.appendChild(terminal)
    element.appendChild(container)

    goWorker(wasmfile, terminal, element, config)
    const run = () => {
        element.dispatchEvent(new CustomEvent(gowasmCustomEvent.run))
    }
    runbutton.onclick = () => { run() }
    run() // autostart
}

const debounce = (delay, f) => {
    let id
    return (...args) => {
        clearTimeout(id)
        id = setTimeout(() => f.apply(this, args), delay)
    }
}

// Our "Go WASM" plugin itself.
const wasmPlugin = (hook, vm) => {
    const config = vm.config.gowasm || {}
    config.wasmloc = typeof config.wasmloc === 'string' ? config.wasmloc : ''
    if (config.wasmloc !== '' && !config.wasmloc.endsWith('/')) {
        config.wasmloc += '/'
    }

    // Invoked on each page load before new markdown is transformed to HTML.
    // Supports asynchronous tasks (see beforeEach documentation for details).
    hook.beforeEach(function () {
        document.querySelectorAll('.gowasm-terminal').forEach(element => {
            element.dispatchEvent(new CustomEvent(gowasmCustomEvent.stop))
        })
    })

    // Invoked on each page load after new HTML has been appended to the DOM.
    hook.doneEach(function () {
        // note: runWasm will autorun.
        document.querySelectorAll('.gowasm-terminal').forEach(element => {
            if (element.dataset.wasm) {
                runWasm(element.dataset.wasm, element, config)
            }
        })
    })

    const termresize = debounce(300, () => {
        document.querySelectorAll('.gowasm-terminal').forEach(element => {
            element.dispatchEvent(new CustomEvent(gowasmCustomEvent.resize))
        })
    })
    window.addEventListener('resize', termresize)
}

// Finally add our plugin to docsify's plugin array...
window.$docsify = window.$docsify || {}
window.$docsify.plugins = [].concat(window.$docsify.plugins || [], wasmPlugin)

window.$docsify.gowasm = {
    // path to where wasm files to be executed are located; if a relative path
    // is specified, then it is relative to the plugin location.
    wasmloc: '',
    // path to where the required Go WASM exec file is located; if a relative
    // path is specified, then it is relative to the plugin location. If set to
    // undefined or empty, then the default "wasm_exec.js" is used.
    wasmexec: 'wasm_exec.js',

    // number of terminal rows (lines).
    rows: 20,
    // number of terminal columns.
    cols: 80,
    // amount of rows retained beyond the initial viewport.
    scrollback: 1000,
    // cursor style when terminal is focused: can be "block", "underline", or
    // "bar".
    cursor: 'block',
    // for cursor "bar", its width in CSS pixels.
    cursorwidth: undefined,
    // cursor style when terminal isn't focused: can be "outline", "block",
    // "underline", "bar", or  "none".
    cursorinactive: 'none',
    // enables or disables cursor blinking.
    blink: false,

    // The font family or families to use; either a string or an array of
    // strings.
    fontfamily: 'monospace',
    // The font size to use.
    fontsize: 14,
    // The line height to use.
    lineheight: 1.1,

    runbutton: 'Run again',

    // message just before a wasm gets run; use "$1" to refer to the value of
    // the data-wasm attribute.
    //
    // Note that you can include ANSI terminal sequences; the reset sequence
    // ("\x1b[0m") will be automatically appended.
    runmsg: 'Running $1...',
    // message after the wasm has successfully terminated.
    //
    // Note that you can include ANSI terminal sequences; the reset sequence
    // ("\x1b[0m") will be automatically appended.
    finishmsg: 'Finished',
    // message preceeding error details.
    //
    // Note that you can include ANSI terminal sequences; the reset sequence
    // ("\x1b[0m") will be automatically appended.
    errormsg: 'error',

    ...(window.$docsify.gowasm ?? {})
}
