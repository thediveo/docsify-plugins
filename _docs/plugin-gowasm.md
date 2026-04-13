# gowasm Plugin

The **gowasm** docsify plugin supports running Go WASM programs in your
markdown, capturing the program's output and displaying it in a neat terminal
inside your markdown page.

Go program  WASM  Docsify with gowasm  WASM execution  XTerm.js

## Limitations

- at most 8k of CLI arguments can be passed to a Go WASM program; this is a
  limitation of the Go WASM runtime.
- [TinyGo](https://github.com/tinygo-org/tinygo) is **not** supported because of
  its own and incompatible `wasm_exec.js` script ([issue
  #5300](https://github.com/tinygo-org/tinygo/issues/5300)); Go's `wasm_exec.js`
  **cannot** be used with Go WASM binaries built with TinyGo.

## Living Example

Put an HTML `<div>` element with class `gowasm-terminal` in your markdown
documents where you want a terminal to appear that renders the output of your Go
WASM binary.

```markdown
<div class='gowasm-terminal' data-wasm='hellorld.wasm' 
    data-args="Hellorld!" data-rows="4"></div>
```

The Go WASM program is automatically executed and its output rendered as shown
below.

<div class='gowasm-terminal' data-wasm='hellorld.wasm' data-args="Hellorld!" data-rows="4"></div>

Notice, how you can customize the terminal size and pass a command line to the
Go WASM program using various `data-*` attributes.

## Loading gowasm

To use the **gowasm** plugin, add the following lines to your `index.html`,
after you've `<script>`-loaded docsify.

> [!IMPORTANT] Ensure that you load `gowasm-plugin.js` with `type="module"`.

```html
<!-- xterm -->
<script src="//cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script src="//cdn.jsdelivr.net/npm/@xterm/addon-web-fonts/lib/addon-web-fonts.js"></script>
<script src="//cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.min.js"></script>
<!-- Go wasm runner with terminal plugin -->
<script type="module" src="_plugins/gowasm/gowasm-plugin.js"></script>
```

We recommend additionally using our
[**codefenceanchors**](/plugin-codefenceanchors)
plugin as to be able to pass the verbatim contents of fenced code blocks as
arguments to Go WASM programs. When using the **codefenceanchors** plugin, make
sure to load it before the **gowasm** plugin.

## Plugin Customization

The **gowasm** supports the following global configuration settings with the
following default values:

```js
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
}
```

## Data Attributes

The following `data-` attributes are supported on HTML elements with class
`gowasm-terminal`. They override any plugin defaults or plugin customizations
for the HTML element only on which they are set.

- WASM related:
  - `data-wasm` (mandatory): the Go WASM file to run.
  - `data-wasmexec`: optionally different Go WASM exec to use if the Go WASM
    file needs a different version of `wasmexec.js`.
  - `data-args`: optional string with CLI arguments to pass to the Go WASM
      program.
      - Simple quoting (`"` and `'`) is supported.
      - any occurences of `${...}` get replaced with the text contents of the
        DOM elements matched by their particular CSS selectors `...`.
        - for instance: `${#foobar}`, `${#example\.go}`.
        - please remember to escape special characters (such as `.`) in CSS id
        selectors that are otherwise taken in their CSS selector meaning.
- gowasm plugin-related:
  - `data-runmsg`: the message to print in the terminal when a Go WASM program
    is started.
  - `data-finishmsg`: the message to print in the terminal when the program has
    finished.
  - `data-errormsg`: the message to print in the terminal after the program has
    finished.
- terminal-related:
  - `data-rows`: number of terminal viewport rows.
  - `data-cols`: number of terminal viewport columns.
  - `data-scrollback`: amount of rows retained beyond the terminal viewport.
  - `data-cursor`: cursor style when terminal is focused.
  - `data-cursor-inactive`: cursor style when terminal isn't focused.
  - `data-cursor-width`: for `data-cursor="bar"` the width in CSS pixels.
  - `data-blink`: enables or disabled cursor blinking.

## Advanced

### Nerd Fonts

[Nerd Fonts](https://www.nerdfonts.com/) and their Nerd Symbols font in
particular combine a large set (10.000+) icons from popular fonts such as
Material Design Icons and Font Awesome in a single (symbol) font. In the
following, we assume that you just want to additionally drop in the symbols, not
replace the fonts you're already using their Nerd variants.

First, you need to make the Nerd Font symbols available. For this, create a file
`nerd-symbols.css` and place it in your favorite location inside your documents tree.

```css
@font-face {
    font-family: 'Nerd Symbols';
    src: url('../_fonts/nerd-symbols-regular.woff2') format('woff2');
}

@font-face {
    font-family: 'Nerd Symbols Mono';
    src: url('../_fonts/nerd-symbols-mono.woff2') format('woff2');
}
```

The WOFF2-encoded font files can be found in this project repository; they have
been converted from their original TTF variants – unfortunately, the Nerd Font
project does not provide their fonts in WOFF2 encoding.

Next, link to this stylesheet:

```html
<link rel="stylesheet" href="_css/nerd-symbols.css">
```

Then, customize the `gowasm` plugin so that the terminal knows the Nerd Font
symbols to use and we use the chance to tinker around with the gowasm messages:

```js
const ANSI = {
    reset: '\x1b[0m',
    gray: '\x1b[38;5;250m',
}

window.$docsify = {
    fontfamily: ['Roboto Mono', 'Nerd Symbols Mono', 'monospace'],

    runbutton: '󰑓 Run again',

    runmsg: ANSI.gray + ' Running $1...',
    finishmsg: ANSI.gray + ' Finished',
    errormsg: ANSI.red + ' error',
}
```


### CDN Delivery

Instead of packaging the matching `wasm_exec.js` for your Go WASM binaries, you
can get them delivered by [jsDelivr](https://www.jsdelivr.com). We recommend
pinning, as shown below.

```js
window.$docsify = {
    gowasm: {
        wasmexec: '//cdn.jsdelivr.net/gh/golang/go@go1.26.2/lib/wasm/wasm_exec.min.js',
    }
}
```

This has the neat side effect that the CDN minimizes the original file all the
same.
