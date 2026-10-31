let worker: Worker | undefined
let serial = 0
const pending = new Map<
  number,
  {
    method: string
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }
>()
export function cryptoCall<T>(method: string, args: unknown): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }) => {
      const call = pending.get(data.id)
      if (!call) return
      pending.delete(data.id)
      if (data.ok) call.resolve(data.result)
      else {
        call.reject(new Error('crypto.failed'))
        if (['encrypt', 'decrypt'].includes(call.method)) {
          destroyCrypto()
          window.dispatchEvent(new Event('photobunker-photo-crypto-failed'))
        }
      }
    }
    worker.onerror = () => {
      destroyCrypto()
      window.dispatchEvent(new Event('photobunker-photo-crypto-failed'))
    }
  }
  const id = ++serial
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      method,
      resolve: resolve as (value: unknown) => void,
      reject,
    })
    try {
      worker!.postMessage({ id, method, args })
    } catch {
      pending.delete(id)
      reject(new Error('crypto.failed'))
    }
  })
}
export function destroyCrypto() {
  worker?.terminate()
  worker = undefined
  for (const call of pending.values()) call.reject(new Error('crypto.locked'))
  pending.clear()
}
