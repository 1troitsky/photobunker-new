import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const result = spawnSync(process.execPath, [resolve(here, 'check.mjs'), resolve(here, 'fixtures/src')], {
  encoding: 'utf8',
})

const output = `${result.stdout}\n${result.stderr}`
if (result.status === 0 || !output.includes('forbidden domain -> infrastructure')) {
  console.error('Architecture negative fixture was not rejected as expected')
  process.exit(1)
}

console.log('Architecture negative fixture rejected as expected')
