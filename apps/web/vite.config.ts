/// <reference types="vitest/config" />

import vue from '@vitejs/plugin-vue'
import { defineConfig, type ProxyOptions } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const identityProxy = process.env.PHOTOBUNKER_IDENTITY_PROXY

// Preview is a reverse proxy, not a new security origin. Retain the genuine
// browser Origin and Host for Laravel's strict origin/CSRF enforcement; never
// substitute a trusted value for a missing or invalid browser Origin.
function backendProxy(target:string):ProxyOptions{
  return {target,changeOrigin:false,configure(proxy){
    proxy.on('proxyReq',(outgoing,incoming)=>{
      const origin=incoming.headers.origin
      if(typeof origin==='string')outgoing.setHeader('Origin',origin)
    })
  }}
}

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      workbox: {
        inlineWorkboxRuntime: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        id: '/',
        name: 'PhotoBunker',
        short_name: 'PhotoBunker',
        description: 'Private photography. Anonymous accounts, controlled access, no system-gallery writes.',
        theme_color: '#111216',
        background_color: '#111216',
        display: 'standalone',
        start_url: '/welcome',
        scope: '/',
        icons: [
          { src: '/favicon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
          { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
  preview: {
    proxy: identityProxy ? {
      '/identity/v2': backendProxy(identityProxy),
      '/photos/v1': backendProxy(identityProxy),
      '/assignments/v1': backendProxy(identityProxy),
      '/collaboration/v1': backendProxy(identityProxy),
    } : undefined,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), geolocation=(self)',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; trusted-types photobunker-pwa; require-trusted-types-for 'script'",
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
