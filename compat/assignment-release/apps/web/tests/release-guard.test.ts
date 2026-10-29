import { afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.unstubAllGlobals() })
it('refuses plaintext storage in a production build without explicit prototype opt-in', async () => {
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_LOCAL_PROTOTYPE', '')
  const open = vi.fn()
  vi.stubGlobal('indexedDB', { open })
  vi.resetModules()
  const { listPhotos, localPrototype } = await import('../src/local/photos')
  expect(localPrototype).toBe(false)
  await expect(listPhotos()).rejects.toThrow('Local prototype disabled')
  expect(open).not.toHaveBeenCalled()
})

it('keeps encrypted identity and account-key storage enabled in production', async () => {
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_LOCAL_PROTOTYPE', '')
  vi.stubGlobal('crypto', webcrypto)
  const open = vi.fn(() => {
    const transaction = () => {
      const tx = {
        objectStore: () => ({
          get: () => ({ result: undefined }),
          getAll: () => ({ result: [] }),
        }),
      } as unknown as IDBTransaction
      queueMicrotask(() => tx.oncomplete?.(new Event('complete') as IDBTransactionEventMap['complete']))
      return tx
    }
    const database = {
      transaction,
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
    } as unknown as IDBDatabase
    const request = { result: database } as IDBOpenDBRequest
    queueMicrotask(() => request.onsuccess?.(new Event('success') as Event))
    return request
  })
  vi.stubGlobal('indexedDB', { open })

  const encrypted = await import('../src/crypto/database')
  await expect(encrypted.get('account-key:synthetic')).resolves.toBeUndefined()
  const identity = await import('../src/identity/keys')
  await expect(identity.credentials()).resolves.toEqual([])
  expect(open).toHaveBeenCalledWith('photobunker-encrypted-queue-v1', 1)
  expect(open).toHaveBeenCalledWith('photobunker-identity-devices-v1', 2)
})
