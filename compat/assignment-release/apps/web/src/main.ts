import { createApp } from 'vue'
import App from './App.vue'
import { startIdentityBootstrap } from './identity/store'
import { resumeLocalDeletion } from './app/local-delete-run'
import { resumeEmergency } from './app/emergency-run'
import { createAppRouter } from './router'
import { initializeLocale } from './i18n'
import { initializePreferences } from './app/preferences'
import './style.css'
import './prototype.css'
import './profiles.css'

initializeLocale()
initializePreferences()
createApp(App).use(createAppRouter()).mount('#app')
// Never await network Identity/Matrix before rendering. Shared photo links
// have an independent public entry point.
// The destructive journal is checked BEFORE any Identity/Matrix bootstrap.
 // Never restore a session or mount private data while a partial wipe exists.
void resumeEmergency().then(safe => {
  if(safe && !location.pathname.startsWith('/s/'))
    void resumeLocalDeletion().then(ok => { if(ok)startIdentityBootstrap() })
})

// The development server deliberately does not install an offline worker.
// A production build served over HTTPS (or localhost) precaches public shell files.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Failure must not block the app or imply that offline storage is ready.
    })
  })
}

import './collaboration.css'
import './app.css'
import './native.css'
import './messages.css'

import './welcome.css'
