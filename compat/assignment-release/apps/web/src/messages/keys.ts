// Local wrapping uses WebCrypto; Matrix/Rust owns every messaging crypto protocol.
type RecordValue = {
  id: string
  wrappingKey: CryptoKey
  iv: Uint8Array<ArrayBuffer>
  encrypted: ArrayBuffer
  initialized?: boolean
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('photobunker-message-storage-v1', 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore('keys', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('messages.storage'))
    request.onblocked = () => reject(new Error('messages.storage'))
  })
}
export async function storageKey(id: string): Promise<Uint8Array<ArrayBuffer>> {
  const db = await database()
  try {
    const existing = await new Promise<RecordValue | undefined>(
      (resolve, reject) => {
        const tx = db.transaction('keys')
        const request = tx.objectStore('keys').get(id)
        tx.oncomplete = () => resolve(request.result)
        tx.onabort = () => reject(new Error('messages.storage'))
      },
    )
    const aad = new TextEncoder().encode(
      `photobunker.messages.storage.v1:${id}`,
    )
    if (existing?.initialized && indexedDB.databases) {
      const databases = await indexedDB.databases()
      if (
        !databases.some((db) => db.name?.startsWith(`photobunker-matrix-${id}`))
      )
        throw new Error('messages.keys_missing')
    }
    if (existing)
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: existing.iv, additionalData: aad },
          existing.wrappingKey,
          existing.encrypted,
        ),
      )
    const raw = crypto.getRandomValues(new Uint8Array(32)),
      iv = crypto.getRandomValues(new Uint8Array(12)),
      wrappingKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      wrappingKey,
      raw,
    )
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      tx.objectStore('keys').add({ id, wrappingKey, iv, encrypted })
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(new Error('messages.storage'))
    })
    return raw
  } finally {
    db.close()
  }
}

export async function markCryptoReady(id: string) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      const request = tx.objectStore('keys').get(id)
      request.onsuccess = () => {
        if (request.result)
          tx.objectStore('keys').put({ ...request.result, initialized: true })
        else tx.abort()
      }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(new Error('messages.storage'))
    })
  } finally {
    db.close()
  }
}

export async function forgetMessageStorage() {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      tx.objectStore('keys').clear()
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(new Error('messages.storage'))
    })
  } finally { db.close() }
}
