import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { registerServiceWorker } from './pwa/register-service-worker'
import { router } from './router'
import './features/ui-preview/ui/preview.css'
import './features/ui-preview/ui/welcome.css'
import './features/identity/ui/identity.css'

/* UI navigation never awaits Identity; background proof check is non-blocking. */
createApp(App).use(createPinia()).use(router).mount('#app')
registerServiceWorker()
void import('./features/identity').then(({ backgroundSessionCheck }) => backgroundSessionCheck()).catch(() => {})
