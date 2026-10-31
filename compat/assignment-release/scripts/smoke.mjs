import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const port = env.match(/^APP_PORT=['"]?(\d+)['"]?\s*$/m)?.[1] ?? '8080'
const origin = `http://localhost:${port}`
for (const path of ['/', '/gallery', '/settings', '/api/v1/health', '/api/v1/ready']) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) })
  assert.equal(response.status, 200, `${path}: response status`)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${path}: nosniff`)
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer', `${path}: referrer policy`)
  assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), `${path}: CSP`)
  if (path.startsWith('/api/')) {
    assert.ok(response.headers.get('cache-control')?.includes('no-store'), `${path}: no-store`)
    assert.equal((await response.json()).status, path.endsWith('/ready') ? 'ready' : 'ok', `${path}: readiness result`)
  } else {
    assert.ok((await response.text()).includes('PhotoBunker'), `${path}: application shell`)
  }
  console.log(`PASS ${path}`)
}
