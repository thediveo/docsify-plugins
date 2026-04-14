# codefenceanchors Plugin

The **codefenceanchors** plugin is primarily intended as a companion to the
[**gowasm** plugin](/plugin-gowasm): it adds HTML `id=` attributes to fenced
code block. The idea then is that a Go WASM program in the same markdown
document can be run with the plain text contents of a fenced code block as its
input to one of its command line args.

## Living Example

Let's put the following fenced code block of some trivial Go source into a
markdown document – but notice the `id=main.go` which defines the HTML anchor
to add.

~~~markdown
```go id=main.go
package main
```
~~~

Not unexpectedly, this renders in this markdown document as follows:

```go id=main.go
package main
```

Now we add a Go WASM terminal, referencing the `main.go` anchor – make sure to
properly escape the "." in the anchor name as it would otherwise be interpreted
as an additionally required CSS class selector.

```markdown
<div class='gowasm-terminal' data-wasm='hellorld.wasm' data-args="${#main\.go}" data-rows="4"></div>
```

And here we go:

<div class='gowasm-terminal' data-wasm='hellorld.wasm' data-args="${#main\.go}" data-rows="4"></div>

## Loading codefenceanchors

To use the **codefenceanchors** plugin, add the following lines to your
`index.html`, after you've `<script>`-loaded docsify, but before (if any)
[**gowasm** plugin](/plugin-gowasm).

```html
<!-- attach user-defined anchor ids to fenced code blocks; must be before Go wasm runner -->
<script src="_plugins/codefenceanchors/codefenceanchors-plugin.js"></script>
<!-- Go wasm runner with terminal plugin -->
<script type="module" src="_plugins/gowasm/gowasm-plugin.js"></script>
```

Note that there are no plugin configurations for **codefenceanchors**.
