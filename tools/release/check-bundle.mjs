import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve('apps/web/dist')
const forbidden = [/matrix-js-sdk/i, /matrix-sdk-crypto/i, /livekit-client/i]

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = walk(dist)
if (!files.some((path) => path.endsWith('index.html'))) {
  throw new Error('Production bundle has no index.html')
}

for (const file of files.filter((path) => /\.(?:js|css|html|json|webmanifest)$/.test(path))) {
  const contents = readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(contents)) throw new Error(`Forbidden legacy runtime found in ${file}: ${pattern}`)
  }
}

console.log(`Production bundle passed (${files.length} files)`)
