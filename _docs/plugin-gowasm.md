# `gowasm` Plugin

The `gowasm` docsify plugin supports running Go programs compiled into WASM in
your markdown, capturing the program's output and displaying it in a neat
terminal region inside your markdown page.

Go program  WASM  Docsify with `gowasm`  WASM execution  XTerm.js

## Live Example

Put an HTML `<div>` element with class `gowasm-terminal` in your markdown
documents where you want a terminal to appear that renders the output of your Go
WASM binary.

```html
<div class='gowasm-terminal' data-wasm='hellorld.wasm' 
    data-args="Hellorld!" data-rows="4"></div>
```

The Go WASM program is automatically executed and its output rendered as shown
below.

<div class='gowasm-terminal' data-wasm='hellorld.wasm' data-args="Hellorld!" data-rows="4"></div>

Notice, how you can customize the terminal size and pass a command line to the
Go WASM program using various `data-*` attributes.

## Plugin Loading

...

## Plugin Configuration

```js
window.$docsify.gowasm = {
    // (relative) path to where the wasm files are located.
    wasmloc: '',

    // number of terminal lines.
    lines: 20,
    // number of terminal columns.
    cols: 80,
    // cursor can be "block", "underline", or "bar".
    cursor: 'block',
    blink: false,
    scrollback: 500,

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
}
```

## Data Attributes

...
