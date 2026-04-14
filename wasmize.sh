#!/bin/bash
set -e

wasmdir=_doc/_wasm
for dir in gowasms/*/; do
    subdir=${dir#gowasms/}
    subdir=${subdir%/}
    maingo=${dir}main.go
    wasm=${subdir}.wasm
    echo "${maingo} ⇒ _docs/_wasm/${wasm}"
    GOOS=js GOARCH=wasm go build -o "/tmp/${wasm}" "${maingo}"
    gzip -9 -f -c "/tmp/${wasm}" >"_docs/_wasm/${wasm}.gz"
done
