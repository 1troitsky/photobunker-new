/// <reference lib="webworker" />
import sodium from 'libsodium-wrappers'
import {
  createKeys,
  unlockKeys,
  rotateKeys,
  clearKeys,
  kitFor,
  type OpenKeys,
  type RecoveryBundle,
  type SodiumPair,
} from './key-material'
import { encryptObject, decryptObject, rewrap } from './codec'
import {
  ready,
  b64,
  unb64,
  canonical,
  hash,
  signed,
  checkRoot,
  checkPacket,
  checkPlan,
  fail,
  utf8,
  text,
  type KeyDocument,
  type Context,
  type Recipient,
  type Packet,
  type SignedPlan,
  type DeviceCertificate,
  type ObjectKind,
  type ObjectStatement,
  verify,
} from './protocol'
let keys: OpenKeys | undefined
let rotatedKeys: OpenKeys | undefined
let pairing: SodiumPair | undefined
function unlocked() {
  if (!keys) return fail()
  return keys
}
async function trust(plan: SignedPlan, ownerFingerprint: string) {
  await checkRoot(plan.authority)
  if (hash(unb64(plan.authority.record.authorityKey, 32)) !== ownerFingerprint)
    return fail()
  if (keys) {
    const self = plan.statement.members.find(
      (member) => member.accountId === keys!.accountId,
    )
    if (self && self.key.record.authorityKey !== b64(keys.authority.publicKey))
      return fail()
  }
}
self.onmessage = async (event: MessageEvent) => {
  const { id, method, args } = event.data
  try {
    await ready()
    let result: unknown
    switch (method) {
      case 'create': {
        const created = createKeys(args.accountId, args.publicId)
        clearKeys(keys)
        keys = created.keys
        result = {
          bundle: created.bundle,
          record: created.record,
          signature: created.signature,
          kit: created.kit,
        }
        break
      }
      case 'unlock': {
        await checkRoot(args.document)
        const opened = unlockKeys(
          args.kit,
          args.bundle as RecoveryBundle,
          args.document as KeyDocument,
        )
        clearKeys(keys)
        keys = opened
        result = {
          accountId: keys.accountId,
          fingerprint: hash(keys.authority.publicKey),
        }
        break
      }
      case 'rotate': {
        const rotated = rotateKeys(unlocked(), args.document)
        clearKeys(rotatedKeys)
        rotatedKeys = rotated.keys
        result = {
          bundle: rotated.bundle,
          record: rotated.record,
          signature: rotated.signature,
          kit: rotated.kit,
        }
        break
      }
      case 'rotate-commit': {
        if (!rotatedKeys) return fail()
        clearKeys(keys)
        keys = rotatedKeys
        rotatedKeys = undefined
        result = true
        break
      }
      case 'rotate-abort': {
        clearKeys(rotatedKeys)
        rotatedKeys = undefined
        result = true
        break
      }
      case 'sign': {
        result = signed(
          args.purpose,
          args.statement,
          unlocked().authority.privateKey,
        )
        break
      }
      case 'read-proof': {
        const current = unlocked(),
          s = args.statement
        if (
          s.version !== 1 ||
          s.purpose !== 'photo-read' ||
          s.accountId !== current.accountId ||
          s.deviceId !== args.deviceId ||
          s.origin !== args.origin ||
          s.keyRevision !== current.revision ||
          s.expiresAt <= Date.now() ||
          s.expiresAt > Date.now() + 125000
        )
          return fail()
        unb64(s.nonce, 32)
        result = signed('read-proof', s, current.read.privateKey)
        break
      }
      case 'encrypt': {
        await trust(args.plan, args.ownerFingerprint)
        await checkPlan(args.plan, args.context.vault_id)
        result = await encryptObject(
          args.blob as Blob,
          args.context as Context,
          args.recipients as Recipient[],
          args.plan.statement.epoch,
          hash(canonical(args.plan)),
          args.pending,
        )
        break
      }
      case 'decrypt': {
        const current = unlocked(),
          packet = args.packet as Packet
        await trust(packet.plan, args.ownerFingerprint)
        await checkPacket(packet, args.expected)
        const envelope =
          args.pending ??
          packet.envelopes.find(
            (envelope) => envelope.accountId === current.accountId,
          )
        if (!envelope) return fail()
        const pairs = args.pending ? current.pending : current.recipients
        const pair = pairs.find(
          (pair) => hash(pair.publicKey) === envelope.fingerprint,
        )
        if (!pair) return fail()
        result = await decryptObject(
          args.blob,
          packet.statement,
          envelope,
          pair.publicKey,
          pair.privateKey,
        )
        break
      }
      case 'rewrap': {
        const current = unlocked(),
          packet = args.packet as Packet
        await trust(args.plan, args.ownerFingerprint)
        await checkPlan(args.plan, packet.statement.descriptor.vault_id)
        await checkPacket(packet, {
          asset_id: packet.statement.descriptor.asset_id,
        })
        if (packet.statement.accountId !== current.accountId) return fail()
        const pair = current.pending.find(
          (pair) => hash(pair.publicKey) === args.pending.fingerprint,
        )
        if (!pair) return fail()
        const envelopes = rewrap(
          packet.statement,
          args.pending,
          pair.publicKey,
          pair.privateKey,
          args.recipients,
          args.plan.statement.epoch,
          {
            accountId: current.accountId,
            publicKey: b64(current.pending.at(-1)!.publicKey),
          },
        )
        result = envelopes
        break
      }
      case 'pair-start': {
        if (pairing) sodium.memzero(pairing.privateKey)
        pairing = sodium.crypto_box_keypair()
        result = { publicKey: b64(pairing.publicKey) }
        break
      }
      case 'pair-send': {
        const current = unlocked()
        if (
          args.request.accountId !== current.accountId ||
          args.request.expiresAt <= Date.now()
        )
          return fail()
        if (
          !Array.isArray(args.trust) ||
          args.trust.length > 2000 ||
          utf8.encode(canonical(args.trust)).length > 524288
        )
          return fail()
        const sealed = b64(
          sodium.crypto_box_seal(
            utf8.encode(
              canonical({
                kit: kitFor(current),
                request: args.request,
                trust: args.trust ?? [],
              }),
            ),
            unb64(args.request.publicKey, 32),
          ),
        )
        result = {
          sealed,
          signature: signed(
            'device-link',
            { request: args.request, sealed },
            current.authority.privateKey,
          ),
        }
        break
      }
      case 'pair-open': {
        if (!pairing) return fail()
        await checkRoot(args.document)
        verify(
          'device-link',
          { request: args.request, sealed: args.response.sealed },
          args.response.signature,
          args.document.record.authorityKey,
        )
        const clear = sodium.crypto_box_seal_open(
          unb64(args.response.sealed, undefined, 750000),
          pairing.publicKey,
          pairing.privateKey,
        )
        if (!clear) return fail()
        try {
          const value = JSON.parse(text.decode(clear))
          if (canonical(value.request) !== canonical(args.request))
            return fail()
          if (
            !Array.isArray(value.trust) ||
            value.trust.length > 2000 ||
            utf8.encode(canonical(value.trust)).length > 524288
          )
            return fail()
          const opened = unlockKeys(value.kit, args.bundle, args.document)
          clearKeys(keys)
          keys = opened
          result = {
            kit: value.kit,
            fingerprint: hash(opened.authority.publicKey),
            trust: value.trust ?? [],
          }
        } finally {
          sodium.memzero(clear)
          sodium.memzero(pairing.privateKey)
          pairing = undefined
        }
        break
      }
      case 'lock': {
        clearKeys(rotatedKeys)
        rotatedKeys = undefined
        clearKeys(keys)
        keys = undefined
        if (pairing) sodium.memzero(pairing.privateKey)
        pairing = undefined
        result = true
        break
      }
      default:
        return fail()
    }
    self.postMessage({ id, ok: true, result })
  } catch {
    self.postMessage({ id, ok: false, error: 'crypto.failed' })
  }
}
// These aliases are part of the worker request boundary; no private key crosses it.
export type WorkerPublicTypes =
  | KeyDocument
  | DeviceCertificate
  | Context
  | ObjectKind
  | ObjectStatement
