import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const localPath = resolve(root, '.env')
const apiPath = resolve(root, 'apps/api/.env')
const parse = (text) => Object.fromEntries(text.split('\n').filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1)]
}))
const rootExists = existsSync(localPath)
const apiExists = existsSync(apiPath)
if (!rootExists && apiExists) {
  console.error('Root .env is missing while apps/api/.env exists. Restore the matching root .env before running setup; existing credentials were preserved.')
  process.exit(1)
}
const existing = rootExists ? parse(readFileSync(localPath, 'utf8')) : {}
const unquote = value => value.trim().replace(/^(['"])(.*)\1$/, '$2')
const credentialKeys = ['POSTGRES_PASSWORD', 'GARAGE_RPC_SECRET', 'GARAGE_DEFAULT_ACCESS_KEY', 'GARAGE_DEFAULT_SECRET_KEY']
if (apiExists && credentialKeys.some(key => !unquote(existing[key] ?? ''))) {
  console.error('Root .env has missing credentials while apps/api/.env exists. Restore the matching credentials before running setup; existing environments were preserved.')
  process.exit(1)
}
const defaults = {
  COMPOSE_PROJECT_NAME: 'photobunker', APP_PORT: '8080', S3_PORT: '3900',
  POSTGRES_DB: 'photobunker', POSTGRES_USER: 'photobunker',
  POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  GARAGE_RPC_SECRET: randomBytes(32).toString('hex'),
  GARAGE_DEFAULT_ACCESS_KEY: `GK${randomBytes(16).toString('hex')}`,
  GARAGE_DEFAULT_SECRET_KEY: randomBytes(32).toString('hex'),
  GARAGE_DEFAULT_BUCKET: 'photobunker',
}
const env = { ...defaults, ...Object.fromEntries(Object.entries(existing).filter(([, value]) => unquote(value) !== '')) }
const port = key => {
  const value = unquote(env[key])
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    console.error(`${key} must be a port number between 1 and 65535; environments were not changed.`)
    process.exit(1)
  }
  return value
}
const appPort = port('APP_PORT')
const s3Port = port('S3_PORT')
writeFileSync(localPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
chmodSync(localPath, 0o600)

if (!apiExists) {
  const template = readFileSync(resolve(root, 'apps/api/.env.example'), 'utf8')
  const settings = {
    APP_NAME: 'PhotoBunker', APP_ENV: 'local', APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
    APP_DEBUG: 'false', APP_URL: `http://localhost:${appPort}`, APP_LOCALE: 'ru', APP_FALLBACK_LOCALE: 'en',
    DB_CONNECTION: 'pgsql', DB_HOST: 'postgres', DB_PORT: '5432', DB_DATABASE: env.POSTGRES_DB,
    DB_USERNAME: env.POSTGRES_USER, DB_PASSWORD: env.POSTGRES_PASSWORD,
    QUEUE_CONNECTION: 'database', CACHE_STORE: 'database', SESSION_DRIVER: 'file', LOG_CHANNEL: 'stderr',
    FILESYSTEM_DISK: 's3', AWS_ACCESS_KEY_ID: env.GARAGE_DEFAULT_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: env.GARAGE_DEFAULT_SECRET_KEY, AWS_DEFAULT_REGION: 'garage',
    AWS_BUCKET: env.GARAGE_DEFAULT_BUCKET, AWS_ENDPOINT: 'http://garage:3900', AWS_USE_PATH_STYLE_ENDPOINT: 'true',
    AWS_BROWSER_ENDPOINT: `http://localhost:${s3Port}`,
    AWS_CORS_ALLOWED_ORIGINS: `http://localhost:${appPort},http://127.0.0.1:${appPort},http://photobunker.orb.local,https://photobunker.orb.local`,
  }
  const lines = template.split('\n').map(line => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (!match || !(match[1] in settings)) return line
    const key = match[1]
    const value = settings[key]
    delete settings[key]
    return `${key}=${value}`
  })
  lines.push(...Object.entries(settings).map(([key, value]) => `${key}=${value}`))
  writeFileSync(apiPath, lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(apiPath, 0o600)
  console.log('Created local environments; credentials were not printed.')
} else {
  chmodSync(apiPath, 0o600)
  console.log('Existing API environment preserved; local credentials were not changed.')
}
