import { account, deviceId } from '../identity/store'
import * as db from './database'
const name = () => `trusted:${account.value?.id}:${deviceId.value}`
type Wrapped = {
  key: CryptoKey
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
}
export async function rememberKit(kit: string) {
  const scope = name(),
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(scope) },
    key,
    new TextEncoder().encode(kit),
  )
  if (scope !== name()) throw new Error('crypto.account_changed')
  await db.put(scope, { key, iv, ciphertext } satisfies Wrapped)
  localStorage.removeItem('pb-trust-revoked:' + scope)
}
export async function rememberedKit() {
  const scope = name()
  if (localStorage.getItem('pb-trust-revoked:' + scope) === 'true') return
  const value = await db.get<Wrapped>(scope)
  if (!value || value.key.extractable) return
  const clear = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: value.iv,
        additionalData: new TextEncoder().encode(scope),
      },
      value.key,
      value.ciphertext,
    ),
  )
  try {
    if (scope !== name()) return
    return new TextDecoder().decode(clear)
  } finally {
    clear.fill(0)
  }
}
