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

const MAGIC_PREFIX = 'code-anchor:'

const extractId = (info) => {
    if (!info) return ''

    const patterns = [
        /\bid="([^"]+)"/,   // id="..."
        /\bid='([^']+)'/,   // id='...'
        /\bid=([^\s]+)/     // id=...
    ]
    for (const re of patterns) {
        const match = info.match(re)
        if (match) return match[1]
    }
    return ''
}

const removeId = (info) => {
    if (!info) return ''

    return info
        .replace(/\bid="[^"]+"/g, '')
        .replace(/\bid='[^']+'/g, '')
        .replace(/\bid=[^\s]+/g, '')
        .trim()
}

const extractLang = (info) => {
    if (!info) return ''

    const cleaned = removeId(info)
    const parts = cleaned.split(/\s+/)
    return parts[0] || ''
}

const install = (hook, vm) => {

    // Process the markdown, placing our own special markers on the code fences
    // we find -- unless its a fenced code fence using "~~~" aroung the "```"
    // which we must ignore. The second later pass then will work on the special
    // markers. We need the markers as can add the HTML attribute only in the
    // later DOM stage, but in that DOM stage the original code fence attributes
    // have been lost.
    hook.beforeEach(function (md) {
        // First, protect fenced blocks fenced by "~~~" by putting the fenced
        // fence aside on our stack and replacing them temporarily with special
        // markers.
        const tildeBlocks = []
        md = md.replace(/~~~[\s\S]*?~~~/g, (block) => {
            tildeBlocks.push(block)
            return `__TILDEFENCE_BLOCK_${tildeBlocks.length - 1}__`
        })

        // Now process unfenced ``` fences as before, putting special markers
        // for the later and separate doneEach phase.
        md = md.replace(/```([^\n]*)\n([\s\S]*?)```/g, (full, info, code) => {
            const id = extractId(info)
            if (!id) return full

            const lang = extractLang(info)
            const cleanFence = `\`\`\`${lang}\n${code}\`\`\``
            return `<!--${MAGIC_PREFIX}${id}-->\n${cleanFence}`
        })

        // Finally, restore the fenced code fence blocks.
        md = md.replace(/__TILDEFENCE_BLOCK_(\d+)__/g, function (_, i) {
            return tildeBlocks[+i]
        })

        return md
    })

    // With the markdown transformed into DOM elements we now remove our special
    // markers, extract the intended anchor id from our markers, and add the ids
    // to the <code> elements.
    hook.doneEach(function () {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_COMMENT,
            null,
            false
        );

        // As we are going to remove the elements with our special markers we
        // cannot safely walk the DOM tree at the same time. So we first collect
        // the marker elements...
        const nodes = []
        let node
        while ((node = walker.nextNode())) {
            if (node.nodeValue.startsWith(MAGIC_PREFIX)) {
                nodes.push(node)
            }
        }
        // ...and then mutate the DOM, removing the special markers and adding
        // the id attributes.
        nodes.forEach(node => {
            const id = node.nodeValue.slice(MAGIC_PREFIX.length)
            let el = node.nextSibling
            while (el) {
                if (el.nodeType === 1 && el.tagName === 'PRE') {
                    const code = el.querySelector('code')
                    if (code && !code.id) {
                        code.id = id
                    }
                    break
                }
                el = el.nextSibling
            }
            node.remove()
        })
    })
}

window.$docsify = window.$docsify || {}
window.$docsify.plugins = [].concat(install, window.$docsify.plugins || [])
