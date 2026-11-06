// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import type { Photo } from '../src/local/photos'
import { publicCardPolicy, publicPhotoCard } from '../src/studio/public-card-policy'
import { CARD_ONLY, decryptCard, encryptCard } from '../src/crypto/card-shares'

const photo = (): Photo => ({
  id:'85acf08b-c2a7-4304-a670-299bc7e53dd8', accountId:'synthetic-owner',
  createdAt:Date.now()-2000, expiresAt:Date.now()+120000, width:400, height:300,
  bytes:1000, mime:'image/jpeg', method:'image-capture', title:'Synthetic card',
  shortId:'TEST0001', note:'Allowed description', tags:['inspection'], favorite:false,
  captureContext:{presetName:'Standard',standard:true,teamName:'Synthetic team',author:{kind:'account',publicId:'synthetic_author'}},
  workspaceAccess:{role:'owner',read:true,thumbnail:true,edit:true,delete:true,share:true,shareExternal:true},
  metadata:{capturedAt:Date.now()-2000,date:'2026-11-06',time:'12:00',camera:'Synthetic camera',editedAt:Date.now()-1000,
    location:{source:'manual',latitude:41.7,longitude:44.8}},
})
beforeAll(() => {
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})
  Object.defineProperty(globalThis,'Blob',{value:NodeBlob,configurable:true})
})
describe('Public card field policy', () => {
  it('snapshots assignment defaults without changing an existing photo when task rules change', () => {
    const task = publicCardPolicy({location:false,tags:true})
    const captured = photo(); captured.metadata!.publicCard = publicCardPolicy(task)
    task.location = true; task.tags = false
    const card = publicPhotoCard(captured)
    expect(card.location).toBeUndefined(); expect(card.tags).toEqual(['inspection'])
    expect(publicCardPolicy().location).toBe(true)
    expect(publicCardPolicy().contributor).toBe(false)
  })
  it('technical metadata cannot bypass hidden dates, GPS or contributor fields', () => {
    const input = photo()
    input.metadata!.publicCard = publicCardPolicy({metadata:true,location:false,description:false})
    const card = publicPhotoCard(input)
    expect(card.metadata?.camera).toBe('Synthetic camera')
    for (const key of ['location','capturedAt','editedAt','author','teamName','description','tags']) expect(card).not.toHaveProperty(key)
    expect(card.metadata).not.toHaveProperty('date'); expect(card.metadata).not.toHaveProperty('time')
    expect(input.metadata?.date).toBe('2026-11-06')
  })
  it('rejects disabled cards and cannot disclose restricted metadata without read permission', () => {
    const input = photo(); input.metadata!.publicCard = publicCardPolicy({enabled:false})
    expect(() => publicPhotoCard(input)).toThrow('public_card.disabled')
    input.metadata!.publicCard = publicCardPolicy({contributor:true,editedAt:true,metadata:true,tags:true})
    input.workspaceAccess!.read = false; input.thumbnailOnly = true
    const card = publicPhotoCard(input)
    for (const key of ['location','capturedAt','editedAt','author','teamName','description','tags','metadata']) expect(card).not.toHaveProperty(key)
  })
  it('roundtrips only selected public fields through the existing encrypted card and enforces photo expiry', async () => {
    const input = photo()
    input.metadata!.publicCard = publicCardPolicy({location:false,tags:true,editedAt:true,contributor:true})
    const card = publicPhotoCard(input), expiry = Date.now()+30000
    const bundle = await encryptCard(card,{...CARD_ONLY,metadata:true},expiry,3600)
    const read = await decryptCard(bundle.ciphertext,bundle.manifest,bundle.secret)
    expect(read.nameId).toBe('TEST0001'); expect(read.tags).toEqual(['inspection'])
    expect(read.teamName).toBe('Synthetic team'); expect(read.editedAt).toBe(input.metadata!.editedAt)
    expect(read.location).toBeUndefined(); expect(read.metadata).toBeUndefined(); expect(read.capturedAt).toBeUndefined()
    expect(JSON.stringify(read)).not.toContain(input.accountId)
    await expect(encryptCard(card,{...CARD_ONLY,metadata:true},input.expiresAt!+1,3600)).rejects.toThrow('card_share.expired')
  })
})
