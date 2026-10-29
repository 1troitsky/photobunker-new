import { b64, unb64, canonical, hash, ready, uuid } from './protocol'
import type { PrivatePhotoCard } from '../studio/private-photo-card'

/** Separate V2 contract; the JPEG /s/:id V1 manifest is never upgraded. */
export type CardScopes = {
  card: true
  photo: boolean
  original: boolean
  download: boolean
  metadata: boolean
}
export const CARD_ONLY: CardScopes = {
  card: true, photo: false, original: false, download: false, metadata: false,
}
export type CardObject = {
  type: 'card'|'photo'|'original'; version: 1; iv: string
  ciphertextHash: string; ciphertextBytes: number
}
const originalMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'] as const
type OriginalMime = typeof originalMimes[number]
export type CardManifest = {
  type: 'photo-card'
  version: 2
  id: string
  scopes: CardScopes
  expiresAt: number
  durationSeconds: 3600 | 86400 | 604800
  object: CardObject
  objects?: { photo?: CardObject & { versionId: string }; original?: CardObject & { mime: OriginalMime } }
}
export type PublicCard = {
  type: 'photo-card-payload'
  version: 1
  title: string
  namePending?: true
  description?: string
  expiresAt: number
  capturedAt?: number
  location?: { latitude: number; longitude: number }
  metadata?: PrivatePhotoCard['metadata']
  author?: { publicId: string }
}
const keys = ['card', 'photo', 'original', 'download', 'metadata'] as const
function scopesValid(input: unknown): input is CardScopes {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const v = input as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) return false
  if (v.card !== true || keys.some(k => typeof v[k] !== 'boolean')) return false
  if (v.download && !v.photo && !v.original) return false
  return true
}
export function validateCardScopes(input: unknown): asserts input is CardScopes {
  if (!scopesValid(input)) throw new Error('card_share.invalid_scopes')
}
export function manifestValid(input: unknown): input is CardManifest {
  if (!input || typeof input !== 'object') return false
  const v = input as Partial<CardManifest>, o = v.object
  const extra = v.objects
  const descriptor = (d: CardObject | undefined, kind: string) =>
    !!d && d.type === kind && d.version === 1 &&
    /^[A-Za-z0-9_-]{16}$/.test(d.iv) && /^[A-Za-z0-9_-]{43}$/.test(d.ciphertextHash) &&
    Number.isSafeInteger(d.ciphertextBytes) && d.ciphertextBytes > 16 &&
    d.ciphertextBytes <= 67108880
  const validExtra = !extra || (
    typeof extra === 'object' && !Array.isArray(extra) &&
    Object.keys(extra).length > 0 && Object.keys(extra).every(k => k === 'photo' || k === 'original') &&
    !!v.scopes && !!v.scopes.photo === !!extra.photo && !!v.scopes.original === !!extra.original &&
    (!extra.photo || (descriptor(extra.photo,'photo') && uuid(extra.photo.versionId) &&
      Object.keys(extra.photo).sort().join(',') ===
        ['type','version','iv','ciphertextHash','ciphertextBytes','versionId'].sort().join(','))) &&
    (!extra.original || (descriptor(extra.original,'original') &&
      originalMimes.includes(extra.original.mime as OriginalMime) &&
      Object.keys(extra.original).sort().join(',') ===
        ['type','version','iv','ciphertextHash','ciphertextBytes','mime'].sort().join(',')))
  )
  return v.type === 'photo-card' && v.version === 2 && uuid(v.id ?? '') &&
    scopesValid(v.scopes) && validExtra &&
    (!!v.scopes?.photo || !!v.scopes?.original) === !!extra &&
    Object.keys(v).sort().join(',') ===
      ['type','version','id','scopes','expiresAt','durationSeconds','object',
        ...(extra ? ['objects'] : [])].sort().join(',') &&
    [3600, 86400, 604800].includes(v.durationSeconds ?? 0) &&
    Number.isSafeInteger(v.expiresAt) && (v.expiresAt ?? 0) > Date.now() &&
    !!o && Object.keys(o).sort().join(',') === ['type','version','iv','ciphertextHash','ciphertextBytes'].sort().join(',') &&
    o.type === 'card' && o.version === 1 &&
    typeof o.iv === 'string' && typeof o.ciphertextHash === 'string' &&
    typeof o.ciphertextBytes === 'number' && Number.isSafeInteger(o.ciphertextBytes) &&
    o.ciphertextBytes > 16 && o.ciphertextBytes <= 32784
}
const aad = (manifest: CardManifest) => new TextEncoder().encode(
  'photobunker/photo-card/v2\0' + canonical({
    type: manifest.type, version: manifest.version, id: manifest.id,
    scopes: manifest.scopes, expiresAt: manifest.expiresAt,
    durationSeconds: manifest.durationSeconds,
    object: { type: manifest.object.type, version: manifest.object.version },
  }),
)
export function publicCardPayload(card: PrivatePhotoCard, scopes: CardScopes, expiresAt: number): PublicCard {
  validateCardScopes(scopes)
  if (!card.expiresAt || expiresAt > card.expiresAt || expiresAt <= Date.now())
    throw new Error('card_share.expired')
  const title = (card.title || card.nameId || '').slice(0, 120)
  if (!title && !card.namePending) throw new Error('card_share.invalid_photo')
  // Only R1-03A's allowlisted card is accepted; no source Photo spreads.
  return {
    type: 'photo-card-payload', version: 1,
    title, ...(!title && card.namePending ? { namePending: true as const } : {}),
    ...(card.description ? { description: card.description.slice(0, 2000) } : {}),
    expiresAt,
    ...(scopes.metadata ? {
      ...(card.capturedAt ? { capturedAt: card.capturedAt } : {}),
      ...(card.location ? { location: { ...card.location } } : {}),
      ...(card.metadata ? { metadata: { ...card.metadata } } : {}),
      ...(card.author ? { author: { publicId: card.author.publicId } } : {}),
    } : {}),
  }
}
function payloadValid(x: unknown, scopes: CardScopes, expiry: number): x is PublicCard {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const v = x as Partial<PublicCard>
  const allowed = ['type', 'version', 'title', 'namePending', 'description', 'expiresAt',
    ...(scopes.metadata ? ['capturedAt', 'location', 'metadata', 'author'] : [])]
  if (Object.keys(v).some(k => !allowed.includes(k)) ||
      v.type !== 'photo-card-payload' || v.version !== 1 ||
      typeof v.title !== 'string' || v.title.length > 120 ||
      (v.namePending !== undefined && v.namePending !== true) ||
      (!v.title && v.namePending !== true) ||
      (v.description !== undefined && (typeof v.description !== 'string' || v.description.length > 2000)) ||
      v.expiresAt !== expiry) return false
  if (v.capturedAt !== undefined && (!Number.isSafeInteger(v.capturedAt) || v.capturedAt <= 0)) return false
  if (v.location && (typeof v.location !== 'object' ||
    Object.keys(v.location).sort().join(',') !== 'latitude,longitude' ||
    !Number.isFinite(v.location.latitude) || !Number.isFinite(v.location.longitude) ||
    Math.abs(v.location.latitude) > 90 || Math.abs(v.location.longitude) > 180)) return false
  if (v.author && (typeof v.author !== 'object' ||
    Object.keys(v.author).join(',') !== 'publicId' ||
    !/^[A-Za-z0-9_-]{2,128}$/.test(v.author.publicId))) return false
  if (v.metadata) {
    if (typeof v.metadata !== 'object' || Array.isArray(v.metadata) ||
        Object.keys(v.metadata).some(k =>
          !['date','time','camera','width','height','bytes','mime','method','accuracy','locationSource'].includes(k)))
      return false
    for (const k of ['date', 'time', 'camera', 'mime', 'method', 'locationSource'] as const)
      if (v.metadata[k] !== undefined && typeof v.metadata[k] !== 'string') return false
    for (const k of ['width', 'height', 'bytes', 'accuracy'] as const)
      if (v.metadata[k] !== undefined &&
          (typeof v.metadata[k] !== 'number' || !Number.isFinite(v.metadata[k]))) return false
  }
  return true
}
export async function encryptCard(card: PrivatePhotoCard, scopes: CardScopes, expiresAt: number,
  durationSeconds: 3600 | 86400 | 604800) {
  await ready()
  if (scopes.photo || scopes.original) throw new Error('card_share.objects_required')
  if (expiresAt > Date.now() + durationSeconds * 1000)
    throw new Error('card_share.invalid_duration')
  const payload = publicCardPayload(card, scopes, expiresAt)
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  if (plain.byteLength > 32768) throw new Error('card_share.too_large')
  const keyMaterial = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const manifest: CardManifest = {
    type: 'photo-card', version: 2, id: crypto.randomUUID(), scopes,
    expiresAt, durationSeconds,
    object: { type: 'card', version: 1, iv: b64(iv), ciphertextHash: '', ciphertextBytes: 0 },
  }
  try {
    const key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt'])
    const data = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: objectAAD(manifest,'card') as Uint8Array<ArrayBuffer>,
      tagLength: 128,
    }, key, plain))
    manifest.object.ciphertextHash = hash(data)
    manifest.object.ciphertextBytes = data.length
    return { manifest, secret: b64(keyMaterial), ciphertext: new Blob([data]) }
  } finally { plain.fill(0); keyMaterial.fill(0) }
}
function objectAAD(manifest: CardManifest, kind: 'card'|'photo'|'original') {
  if (!manifest.objects) return aad(manifest)
  const descriptor = kind === 'card' ? manifest.object : manifest.objects[kind]
  if (!descriptor) throw new Error('card_share.scope')
  return new TextEncoder().encode('photobunker/photo-card/object/v2\0' + canonical({
    type:manifest.type, version:manifest.version, id:manifest.id, kind,
    scopes:manifest.scopes, expiresAt:manifest.expiresAt,
    durationSeconds:manifest.durationSeconds,
    versionId:kind === 'photo' ? manifest.objects.photo?.versionId : null,
    object:{type:descriptor.type,version:descriptor.version,
      ...(kind === 'original' ? { mime: manifest.objects.original?.mime } : {})},
  }))
}
export async function encryptCardBundle(card: PrivatePhotoCard, scopes: CardScopes,
  expiresAt:number, durationSeconds:3600|86400|604800,
  files:{photo?:{blob:Blob;versionId:string}; original?:Blob},
) {
  await ready()
  validateCardScopes(scopes)
  if (!!scopes.photo !== !!files.photo || !!scopes.original !== !!files.original ||
    (files.photo && (!uuid(files.photo.versionId) || files.photo.blob.type !== 'image/jpeg')) ||
    (files.original && !originalMimes.includes(files.original.type as OriginalMime)))
    throw new Error('card_share.invalid_object')
  if (!files.photo && !files.original)
    return encryptCard(card,scopes,expiresAt,durationSeconds).then(v => ({
      ...v, objects:{card:v.ciphertext} as Record<string,Blob>,
    }))
  if (expiresAt > Date.now()+durationSeconds*1000)
    throw new Error('card_share.invalid_duration')
  const payload = publicCardPayload(card,scopes,expiresAt)
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt'])
  const manifest:CardManifest = {
    type:'photo-card',version:2,id:crypto.randomUUID(),scopes,expiresAt,durationSeconds,
    object:{type:'card',version:1,iv:'',ciphertextHash:'',ciphertextBytes:0},
    objects:{
      ...(files.photo ? {photo:{type:'photo' as const,version:1 as const,
        versionId:files.photo.versionId,iv:'',ciphertextHash:'',ciphertextBytes:0}} : {}),
      ...(files.original ? {original:{type:'original' as const,version:1 as const,
        mime:files.original.type as OriginalMime,iv:'',ciphertextHash:'',ciphertextBytes:0}} : {}),
    },
  }
  const objects:Record<string,Blob> = {}
  try {
    for (const [kind,blob] of [
      ['card',new Blob([JSON.stringify(payload)])],
      ...(files.photo ? [['photo',files.photo.blob]] : []),
      ...(files.original ? [['original',files.original]] : []),
    ] as [ 'card'|'photo'|'original',Blob ][]) {
      if (!blob.size || blob.size > 64*1024*1024) throw new Error('card_share.invalid_size')
      const iv=crypto.getRandomValues(new Uint8Array(12))
      const descriptor=kind==='card'?manifest.object:manifest.objects![kind]!
      descriptor.iv=b64(iv)
      const bytes=new Uint8Array(await crypto.subtle.encrypt({
        name:'AES-GCM',iv,additionalData:objectAAD(manifest,kind) as Uint8Array<ArrayBuffer>,
        tagLength:128,
      },key,await blob.arrayBuffer()))
      descriptor.ciphertextHash=hash(bytes)
      descriptor.ciphertextBytes=bytes.byteLength
      objects[kind]=new Blob([bytes])
    }
    if (!manifestValid(manifest)) throw new Error('card_share.invalid_manifest')
    return {manifest,secret:b64(raw),ciphertext:objects.card!,objects}
  } finally {raw.fill(0)}
}
export async function decryptCardObject(blob:Blob,manifest:CardManifest,secret:string,kind:'photo'|'original') {
  await ready()
  if (!manifestValid(manifest) || !manifest.scopes[kind] || !manifest.objects?.[kind])
    throw new Error('card_share.scope')
  const d=manifest.objects[kind]!
  if (blob.size!==d.ciphertextBytes) throw new Error('card_share.invalid_object')
  const raw=unb64(secret,32)
  try {
    const bytes=new Uint8Array(await blob.arrayBuffer())
    if (hash(bytes)!==d.ciphertextHash) throw new Error('card_share.tampered')
    const key=await crypto.subtle.importKey('raw',raw as Uint8Array<ArrayBuffer>,'AES-GCM',false,['decrypt'])
    const clear=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(d.iv,12) as Uint8Array<ArrayBuffer>,
      additionalData:objectAAD(manifest,kind) as Uint8Array<ArrayBuffer>,tagLength:128,
    },key,bytes))
    try{return new Blob([clear],{type:kind==='photo'?'image/jpeg':manifest.objects.original!.mime})}
    finally{clear.fill(0)}
  }finally{raw.fill(0)}
}
export async function decryptCard(blob: Blob, manifest: CardManifest, secret: string): Promise<PublicCard> {
  await ready()
  if (!manifestValid(manifest) || blob.size !== manifest.object.ciphertextBytes)
    throw new Error('card_share.invalid_manifest')
  const raw = unb64(secret, 32)
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (hash(bytes) !== manifest.object.ciphertextHash) throw new Error('card_share.tampered')
    const key = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['decrypt'])
    const clear = new Uint8Array(await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: unb64(manifest.object.iv, 12) as Uint8Array<ArrayBuffer>,
      additionalData: objectAAD(manifest,'card') as Uint8Array<ArrayBuffer>, tagLength: 128,
    }, key, bytes))
    try {
      const payload: unknown = JSON.parse(new TextDecoder().decode(clear))
      if (!payloadValid(payload, manifest.scopes, manifest.expiresAt))
        throw new Error('card_share.invalid_payload')
      return payload
    } finally { clear.fill(0) }
  } finally { raw.fill(0) }
}
