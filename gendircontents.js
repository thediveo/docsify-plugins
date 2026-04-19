#!/usr/bin/env node

const dircontentsjson = '--dircontents.json'

const fs = require('fs')
const path = require('path')

function scanDirectorySync(dirPath) {
    let entries

    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch (err) {
        console.error(`Error reading directory: ${dirPath}`, err.message)
        return
    }

    const results = []
    const subdirs = []
    for (const entry of entries) {
        // never include yourself
        if (entry.name === dircontentsjson) {
            continue
        }
        const fullpath = path.join(dirPath, entry.name)
        try {
            if (entry.isDirectory()) {
                results.push({
                    name: entry.name,
                    type: 'directory'
                })
                subdirs.push(fullpath)
                continue
            }
            if (entry.isFile()) {
                const stats = fs.statSync(fullpath)
                results.push({
                    name: entry.name,
                    type: 'file',
                    size: stats.size
                })
            }
        } catch (err) {
            console.error(`Error processing: ${fullpath}`, err.message)
        }
    }

    const outputPath = path.join(dirPath, dircontentsjson)

    try {
        fs.writeFileSync(
            outputPath,
            JSON.stringify(results, null, 2),
            'utf8',
        )
        console.log(`Written: ${outputPath}`)
    } catch (err) {
        console.error(`Error writing file: ${outputPath}`, err.message)
    }

    for (const fullpath of subdirs) {
        scanDirectorySync(fullpath)
    }
}

function main() {
    const targetDir = process.argv[2]

    if (!targetDir) {
        console.error("Usage: node script.js <directory-path>")
        process.exit(1)
    }

    const resolvedPath = path.resolve(targetDir)

    try {
        const stats = fs.statSync(resolvedPath)

        if (!stats.isDirectory()) {
            console.error("Provided path is not a directory.")
            process.exit(1)
        }
    } catch (err) {
        console.error("Invalid path:", err.message)
        process.exit(1)
    }

    scanDirectorySync(resolvedPath)
}

main()
