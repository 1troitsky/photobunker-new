import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { renderServiceWorker } from './scripts/service-worker'

// Only emitted, public application files enter the precache. No runtime
// cache patterns: future API responses, signed URLs and media stay outside it.
function appShellWorker(): Plugin {
  let outputDirectory = ''
  return {
    name: 'photobunker-app-shell',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const assets = (await readdir(resolve(outputDirectory, 'assets'))).sort()
      const paths = [
        '/', '/manifest.webmanifest', '/icons/favicon.svg',
        ...assets.filter((name) => /\.(?:js|css)$/.test(name)).map((name) => `/assets/${name}`),
      ]
      const digest = createHash('sha256')
      for (const path of paths) {
        digest.update(await readFile(resolve(outputDirectory, path === '/' ? 'index.html' : path.slice(1))))
      }
      await writeFile(resolve(outputDirectory, 'sw.js'), renderServiceWorker(paths, digest.digest('hex').slice(0, 16)))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), appShellWorker()],
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
