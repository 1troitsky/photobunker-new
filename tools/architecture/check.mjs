import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'apps/web/src')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue'])
const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g
const layerOrder = new Map([
  ['domain', 0],
  ['application', 1],
  ['infrastructure', 2],
  ['ui', 3],
])

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function extension(path) {
  return path.slice(path.lastIndexOf('.'))
}

function featureLayer(path) {
  const normalized = relative(root, path).split(sep).join('/')
  const match = normalized.match(/^features\/([^/]+)\/(domain|application|infrastructure|ui)\//)
  return match ? { feature: match[1], layer: match[2], normalized } : null
}

function resolveImport(source, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(source), specifier)
  const candidates = [base, ...sourceExtensions].flatMap((item) =>
    typeof item === 'string' && sourceExtensions.has(item)
      ? []
      : [item, ...[...sourceExtensions].map((suffix) => `${item}${suffix}`)],
  )
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  }) ?? null
}

const violations = []

for (const file of walk(root).filter((path) => sourceExtensions.has(extension(path)))) {
  const sourceBoundary = featureLayer(file)
  if (!sourceBoundary) continue
  const contents = readFileSync(file, 'utf8')

  for (const match of contents.matchAll(importPattern)) {
    const target = resolveImport(file, match[1])
    if (!target) continue
    const targetBoundary = featureLayer(target)
    if (!targetBoundary) continue

    if (sourceBoundary.feature !== targetBoundary.feature) {
      violations.push(`${sourceBoundary.normalized}: cross-feature deep import ${match[1]}`)
      continue
    }

    const sourceRank = layerOrder.get(sourceBoundary.layer)
    const targetRank = layerOrder.get(targetBoundary.layer)
    if (targetRank > sourceRank) {
      violations.push(
        `${sourceBoundary.normalized}: forbidden ${sourceBoundary.layer} -> ${targetBoundary.layer} import ${match[1]}`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log(`Architecture boundaries passed for ${relative(process.cwd(), root)}`)
