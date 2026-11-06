import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { renderServiceWorker } from './scripts/service-worker'

// Only emitted, public application files enter the precache. No runtime
// cache patterns: future API responses, signed URLs and media stay outside it.
function appShellWorker(buildId: string): Plugin {
  let outputDirectory = ''
  return {
    name: 'photobunker-app-shell',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      // Precache only the files required to paint the public shell. Caching
      // every emitted route chunk used to make a fresh tab download the
      // postponed Matrix/LiveKit implementation and image editor even when
      // the user only opened Assignments or Browser.
      const index = await readFile(resolve(outputDirectory, 'index.html'), 'utf8')
      const shellAssets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)]
        .map((match) => match[1]!)
      const paths = [
        '/', '/manifest.webmanifest', '/favicon.ico',
        '/icons/favicon.svg', '/icons/favicon-96x96.png',
        '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
        '/icons/brand-logo-192.webp',
        ...shellAssets,
      ]
      const digest = createHash('sha256')
      for (const path of paths) {
        digest.update(await readFile(resolve(outputDirectory, path === '/' ? 'index.html' : path.slice(1))))
      }
      await writeFile(resolve(outputDirectory, 'sw.js'), renderServiceWorker(paths, digest.digest('hex').slice(0, 16)))
      await writeFile(resolve(outputDirectory, 'release.json'), JSON.stringify({ buildId }) + '\n')
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // A release marker is embedded into the client and published separately.
  // Installed PWAs can therefore detect a newer shell even when Safari keeps
  // the old page process alive between launches.
  const buildId = env.PHOTOBUNKER_RELEASE_ID?.trim() ||
    `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.pid}`
  return {
    plugins: [vue(), {
      name: 'photobunker-private-filemanager',
      enforce: 'pre',
      transform(code, id) {
        // SVAR 2.6 logs private folder names during tree rendering.
        if (/node_modules\/(?:@svar-ui\/vue-filemanager\/dist\/|\.vite\/deps\/@svar-ui_vue-filemanager)/.test(id))
          return code.replaceAll('console.log(', '(() => undefined)(')
      },
    }, appShellWorker(buildId)],
    define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId) },
    optimizeDeps: { exclude: ['@matrix-org/matrix-sdk-crypto-wasm'] },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: ['localhost', 'assignment-release.photobunker.orb.local'],
      cors: false,
      // Docker Desktop/OrbStack bind mounts can miss native file watcher events.
      watch: { usePolling: true, interval: 500 },
      // Vite infers ws/wss and the client port from the requested module URL.
      // The gateway forwards Upgrade on the same origin as the app.
      proxy: {
        '/api': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:8000' },
      },
    },
    preview: { allowedHosts: ['localhost', 'assignment-release.photobunker.orb.local'] },
  }
})
