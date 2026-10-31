// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { ready, b64 } from '../src/crypto/protocol'
import { encryptCard, decryptCard, decryptCardObject, encryptCardBundle, publicCardPayload, validateCardScopes, CARD_ONLY } from '../src/crypto/card-shares'
import type { PrivatePhotoCard } from '../src/studio/private-photo-card'

beforeAll(async () => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true })
  await ready()
})
const card = (): PrivatePhotoCard => ({
  id: '85acf08b-c2a7-4304-a670-299bc7e53dd8',
  title: 'Synthetic title', description: 'Allowed public description',
  nameId: 'ABCD0001', namePending: false, expiresAt: Date.now() + 120_000,
  capturedAt: Date.now() - 12_000, location: { latitude: 41.721, longitude: 44.826 },
  metadata: { camera: 'camera', width: 300, height: 400, bytes: 2000,
    mime: 'image/jpeg', method: 'image-capture' },
  author: { publicId: 'pb_test_author' },
})
describe('R1-03B / card-only E2EE without JPEG', () => {
  it('opens a guest-only route separate from legacy /s, preserving old route type', () => {
    const router = createAppRouter(createMemoryHistory())
    const id = crypto.randomUUID()
    expect(router.resolve('/c/' + id).name).toBe('shared-card')
    expect(router.resolve('/s/' + id).name).toBe('shared-photo')
  })
  it('explicitly rejects impossible image scopes rather than revealing an unmasked JPEG', () => {
    for (const scopes of [
      { ...CARD_ONLY, download: true },
      { ...CARD_ONLY, card: false },
    ]) expect(() => validateCardScopes(scopes)).toThrow()
  })
  it('does not put GPS, captured date, author, technical metadata or private Notes in default plaintext', () => {
    const input = { ...card(), privateNote: 'SECRET NOTE' }
    const clean = publicCardPayload(input, CARD_ONLY, Date.now() + 10_000)
    expect(clean).toEqual({
      type: 'photo-card-payload', version: 1, title: 'Synthetic title',
      description: 'Allowed public description', expiresAt: clean.expiresAt,
    })
    expect(JSON.stringify(clean)).not.toContain('41.721')
    expect(JSON.stringify(clean)).not.toContain('SECRET NOTE')
  })
  it('preserves an honest pending NAME-ID state instead of publishing an empty heading', () => {
    const pending = { ...card(), title: '', nameId: undefined, namePending: true }
    expect(publicCardPayload(pending, CARD_ONLY, Date.now() + 10_000).namePending).toBe(true)
    expect(() => publicCardPayload({ ...pending, namePending: false }, CARD_ONLY,
      Date.now() + 10_000)).toThrow()
  })
  it('encrypts content with new link secret, type/version, scopes, TTL, and hashes', async () => {
    const expiry = Date.now() + 60_000
    const a = await encryptCard(card(), CARD_ONLY, expiry, 3600)
    const plain = await decryptCard(a.ciphertext, a.manifest, a.secret)
    expect(plain.title).toBe('Synthetic title')
    expect(plain.location).toBeUndefined()
    expect(JSON.stringify(a.manifest)).not.toContain(a.secret)
    const b = await encryptCard(card(), CARD_ONLY, expiry, 3600)
    expect(b.manifest.id).not.toBe(a.manifest.id)
    expect(b.secret).not.toBe(a.secret)
    for (const change of [
      { type: 'wrong' }, { version: 99 }, { id: crypto.randomUUID() },
      { expiresAt: expiry + 1 }, { durationSeconds: 86400 },
      { scopes: { ...CARD_ONLY, metadata: true } },
      { object: { ...a.manifest.object, version: 2 } },
      { unexpected: 'unknown' },
    ]) {
      await expect(decryptCard(a.ciphertext, { ...a.manifest, ...change } as typeof a.manifest,
        a.secret)).rejects.toThrow()
    }
    const damaged = new Uint8Array(await a.ciphertext.arrayBuffer())
    damaged[0]! ^= 1
    await expect(decryptCard(new Blob([damaged]), a.manifest, a.secret)).rejects.toThrow()
    await expect(decryptCard(a.ciphertext, a.manifest, b64(crypto.getRandomValues(new Uint8Array(32))))).rejects.toThrow()
  })
  it('gives only explicitly enabled metadata fields inside authenticated ciphertext', async () => {
    const expiry = Date.now() + 60_000
    const item = await encryptCard(card(), { ...CARD_ONLY, metadata: true }, expiry, 3600)
    const data = await decryptCard(item.ciphertext, item.manifest, item.secret)
    expect(data.location).toEqual({ latitude: 41.721, longitude: 44.826 })
    expect(data.author).toEqual({ publicId: 'pb_test_author' })
    expect(data.capturedAt).toBeDefined()
  })
  it('never allows requested duration or parent expiry to be exceeded', async () => {
    await expect(encryptCard(card(), CARD_ONLY, Date.now() + 2 * 3600_000, 3600)).rejects.toThrow()
    await expect(encryptCard(card(), CARD_ONLY, Date.now() + 150_000, 3600)).rejects.toThrow()
  })
})

describe('R1-03C / independent encrypted image objects', () => {
  it('does not change any legacy v2 card-only ciphertext contract', async () => {
    const p=await encryptCardBundle(card(),CARD_ONLY,Date.now()+60_000,3600,{})
    expect(p.manifest.objects).toBeUndefined()
    expect(Object.keys(p.objects)).toEqual(['card'])
    expect((await decryptCard(p.objects.card!,p.manifest,p.secret)).title).toBe('Synthetic title')
  })
  it('encrypts different kinds with different IVs/AAD; no image fallback', async () => {
    const scopes={...CARD_ONLY,photo:true,original:true,download:true}
    const p=await encryptCardBundle(card(),scopes,Date.now()+60_000,3600,{
      photo:{versionId:'687ced2f-cd6e-4bb9-81e6-6c5f86d6bccb',
        blob:new Blob(['synthetic flattened pixels'],{type:'image/jpeg'})},
      original:new Blob(['synthetic immutable original'], { type: 'image/png' }),
    })
    const m=p.manifest
    expect(m.objects?.photo?.iv).not.toBe(m.object.iv)
    expect(m.objects?.original?.iv).not.toBe(m.objects?.photo?.iv)
    expect(m.objects?.original?.iv).not.toBe(m.object.iv)
    expect(await (await decryptCardObject(p.objects.photo!,m,p.secret,'photo')).text())
      .toBe('synthetic flattened pixels')
    expect(await (await decryptCardObject(p.objects.original!,m,p.secret,'original')).text())
      .toBe('synthetic immutable original')
    expect((await decryptCardObject(p.objects.original!,m,p.secret,'original')).type).toBe('image/png')
    expect((await decryptCard(p.objects.card!,m,p.secret)).title).toBe('Synthetic title')
    await expect(decryptCardObject(p.objects.original!,m,p.secret,'photo')).rejects.toThrow()
    await expect(decryptCardObject(p.objects.photo!,{...m,scopes:{...scopes,photo:false}},
      p.secret,'photo')).rejects.toThrow()
    await expect(decryptCardObject(p.objects.photo!,{...m,objects:{...m.objects,
      photo:{...m.objects!.photo!,versionId:crypto.randomUUID()}}},
      p.secret,'photo')).rejects.toThrow()
    await expect(decryptCardObject(p.objects.photo!,m,b64(crypto.getRandomValues(new Uint8Array(32))),
      'photo')).rejects.toThrow()
  })
  it('rejects missing selected version and unmatched encrypted objects', async () => {
    const scope={...CARD_ONLY,photo:true}
    await expect(encryptCardBundle(card(),scope,Date.now()+30_000,3600,{})).rejects.toThrow()
    await expect(encryptCardBundle(card(),CARD_ONLY,Date.now()+30_000,3600,{
      original:new Blob(['unexpected'])})).rejects.toThrow()
    await expect(encryptCardBundle(card(),scope,Date.now()+30_000,3600,{
      photo:{versionId:'missing',blob:new Blob(['pixels'],{type:'image/jpeg'})},
    })).rejects.toThrow()
  })
})
