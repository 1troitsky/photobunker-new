// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const asset = (path: string) => new URL('../public' + path, import.meta.url)
function pngSize(bytes: Buffer): string {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20)
}

describe('R1-10 / exact owner-provided install icons', () => {
  it('keeps manifest entries loadable at their declared PNG sizes', async () => {
    const manifest = JSON.parse(await readFile(asset('/manifest.webmanifest'), 'utf8'))
    expect(manifest.id).toBe('/')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    for (const icon of manifest.icons) {
      const bytes = await readFile(asset(icon.src))
      expect(icon.type).toBe('image/png')
      expect(pngSize(bytes)).toBe(icon.sizes)
    }
    expect(manifest.icons.map((icon: {sizes: string}) => icon.sizes))
      .toEqual(expect.arrayContaining(['192x192', '512x512']))
  })

  it('ships a real ICO, 180px Apple icon, welcome logo and source SVG', async () => {
    const ico = await readFile(asset('/favicon.ico'))
    expect(ico.subarray(0, 4).toString('hex')).toBe('00000100')
    expect(pngSize(await readFile(asset('/icons/apple-touch-icon.png')))).toBe('180x180')
    expect(pngSize(await readFile(asset('/icons/brand-logo.png')))).toBe('796x796')
    const svg = await readFile(asset('/icons/favicon.svg'), 'utf8')
    expect(svg).toContain('<svg')
  })
})
