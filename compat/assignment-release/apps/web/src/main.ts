import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { startIdentityBootstrap } from './identity/store'
import { resumeLocalDeletion } from './app/local-delete-run'
import { resumeEmergency } from './app/emergency-run'
import { createAppRouter, warmPrimaryRoutes } from './router'
import { initializeLocale } from './i18n'
import { initializePreferences } from './app/preferences'
import { startDiagnostics } from './app/status'
import { startPwaUpdates } from './app/pwa-update'
import './style.css'
import './prototype.css'
import './profiles.css'

initializeLocale()
initializePreferences()
function startPrivateApp() {
  const router = createAppRouter()
  startDiagnostics(router)
  createApp(App).use(router).mount('#app')
  const warmRoutes = () => { void warmPrimaryRoutes() }
  const idleCallback = Reflect.get(window, 'requestIdleCallback') as
    | ((callback: () => void, options?: { timeout: number }) => number)
    | undefined
  if (typeof idleCallback === 'function')
    idleCallback(warmRoutes, { timeout: 1500 })
  else globalThis.setTimeout(warmRoutes, 250)
  // Never await network Identity/Matrix before rendering. Shared photo links
  // have an independent public entry point.
  // The destructive journal is checked BEFORE any Identity/Matrix bootstrap.
   // Never restore a session or mount private data while a partial wipe exists.
  void resumeEmergency().then(safe => {
    if(safe && !location.pathname.startsWith('/s/'))
      void resumeLocalDeletion().then(ok => { if(ok)startIdentityBootstrap() })
  })

  // Development deliberately has no offline worker. Production checks a small
  // no-store release marker on launch/resume and reloads the public shell once
  // when a new build is available. Private IndexedDB/OPFS data is untouched.
  startPwaUpdates()
}

if (location.pathname.startsWith('/c/')) {
  // Public Photo-card has its own root: no App, PIN, identity recovery,
  // private outbox, route warm-up or PWA reload process is started here.
  void import('./views/PhotoCardView.vue').then(async ({default:Page}) => {
    const publicRouter = createRouter({history:createWebHistory(),routes:[{path:'/c/:id',component:Page}]})
    const page = createApp(Page).use(publicRouter)
    await publicRouter.isReady()
    document.title = 'Public card · PhotoBunker'
    page.mount('#app')
  }).catch(() => {
    const root = document.getElementById('app')
    if (root) root.textContent = 'Не удалось загрузить Public card. Обновите страницу.'
  })
} else startPrivateApp()


import './collaboration.css'
import './app.css'
import './native.css'
import './messages.css'

import './welcome.css'
