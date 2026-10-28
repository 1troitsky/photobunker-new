type TrustedScriptUrlPolicy = {
  createScriptURL(value: string): unknown
}

type TrustedTypesFactory = {
  createPolicy(
    name: string,
    rules: { createScriptURL(value: string): string },
  ): TrustedScriptUrlPolicy
}

const SERVICE_WORKER_URL = '/sw.js'

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    const trustedTypes = (window as Window & { trustedTypes?: TrustedTypesFactory }).trustedTypes
    const scriptUrl = trustedTypes
      ? trustedTypes
          .createPolicy('photobunker-pwa', {
            createScriptURL(value) {
              if (value !== SERVICE_WORKER_URL) throw new TypeError('Unexpected service worker URL')
              return value
            },
          })
          .createScriptURL(SERVICE_WORKER_URL)
      : SERVICE_WORKER_URL

    void navigator.serviceWorker.register(scriptUrl as string, { scope: '/' }).catch(() => {
      // Online operation remains available; a later navigation retries registration.
    })
  })
}
