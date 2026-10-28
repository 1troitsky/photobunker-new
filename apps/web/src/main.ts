import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router'
import './features/ui-preview/ui/preview.css'
import './features/ui-preview/ui/welcome.css'

/* Preview: no identity, camera, storage, S3, API or messenger bootstraps. */
createApp(App).use(createPinia()).use(router).mount('#app')
