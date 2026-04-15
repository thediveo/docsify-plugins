# TheDiveO's Docsify Plugins

My plugins contribution to the [docsify magical documentation site
generator](https://docsify.js.org/#/?id=docsify):
- [**gowasm**](/plugin-gowasm) – run Go WASM binaries in your markdown document
  and render their outputs in terminals inside your documents.
- [**codefenceanchors**](/plugin-codefenceanchors) – add HTML `id=` attributes
  to fenced code blocks, so that you can pass the block contents as command line
  arguments to your Go WASM binaries.

## Example Madness

Given the following little Go program...

```go id=hellorld.go
package main

import (
	"fmt"
	"os"
)

func main() {
	song := "wot?"
	if len(os.Args) > 1 {
		song = os.Args[1]
	}
	fmt.Printf("The 66 dancing Gophers in your browser sing: %s\n", song)
}
```

...the resulting (compressed) WASM binary of ~740k is then loaded into the
browser when this page gets rendered, and then executed in a separate [web
worker](https://en.wikipedia.org/wiki/Web_worker) in the background – to keep
the web page responsive.

You can even control your gopher's song – make sure to press "Run again" after
changing their song:

<input id="xxx" type="text" placeholder="Enter name" value="Hellorld!">

<div class='gowasm-terminal' data-wasm='hellorld.wasm' data-args="${#xxx}" data-rows="4"></div>

## Background

The **gowasm** plugin came into live while I was learning the ropes of [Go
Analyzers](https://pkg.go.dev/golang.org/x/tools/go/analysis#hdr-Analyzer): in
some cases the AST isn't enough and working with the [SSA
IR](https://pkg.go.dev/golang.org/x/tools/go/ssa). The SSA IR is a static
single-assignment intermediate representation – please note that the Go compiler
uses a _different_ SSA than the analyzer SSA. Unfortunately, there are barely
any examples of what the SSA graphs look like and since the SSA nodes are
heavily cyclically linked there doesn't seem to be a generic analyzer SSA graph
pretty-printer out there.

```go id=main.go
package main

import "fmt"

var Println = fmt.Println

func main() {
	Println("Hellorld!")
}
```

<div class='gowasm-terminal' data-wasm='hellorld.wasm' data-args="${#main\.go}" data-rows="40"></div>
