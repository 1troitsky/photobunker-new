import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, chmodSync } from 'node:fs'
const root = new URL('../', import.meta.url)
const paths = ['.env','apps/api/.env'].map(path => new URL(path, root))
const sources = paths.map(path => readFileSync(path,'utf8'))
const settings = {}
// Validate both environments before writing either; preserve values from either file.
for (const key of ['MATRIX_REGISTRATION_SECRET','MATRIX_BOOTSTRAP_PASSWORD','MATRIX_SERVER_NAME']) {
  const values = sources.map(source => source.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]).filter(value => value !== undefined)
  if (new Set(values).size > 1 || values.some(value => !value)) throw new Error('Matrix settings differ or are empty; restore matching environments instead of rotating them')
  settings[key] = values[0] ?? (key === 'MATRIX_SERVER_NAME' ? 'matrix.photobunker.test' : randomBytes(32).toString('hex'))
}
if (settings.MATRIX_SERVER_NAME !== 'matrix.photobunker.test') throw new Error('This setup is restricted to the explicit local test server name')
for (let index=0;index<paths.length;index++) {
  let source = sources[index]
  for (const [key,value] of Object.entries(settings)) if (!new RegExp(`^${key}=`, 'm').test(source)) source += `\n${key}=${value}\n`
  writeFileSync(paths[index],source,{mode:0o600});chmodSync(paths[index],0o600)
}
console.log('Local Matrix secrets prepared and existing secrets preserved. No secrets printed.')
