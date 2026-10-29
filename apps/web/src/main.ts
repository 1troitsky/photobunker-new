import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { registerServiceWorker } from './pwa/register-service-worker'
import { router } from './router'
import { assignmentReleaseEnabled } from './features/assignment-release'
import './features/ui-preview/ui/preview.css'
import './features/ui-preview/ui/welcome.css'
import './features/identity/ui/identity.css'

/* UI navigation never awaits Identity; background proof check is non-blocking. */
createApp(App).use(createPinia()).use(router).mount('#app')
if (!assignmentReleaseEnabled()) {
  registerServiceWorker()
  void import('./features/identity').then(({ backgroundSessionCheck }) => backgroundSessionCheck()).catch(() => {})
  
  /* Non-blocking foreground encrypted delivery; camera never awaits network. */
  void import('./features/photo-sync').then(({startPhotoSync})=>startPhotoSync()).catch(()=>{})
  void import('./features/assignments').then(({startAssignmentSync})=>startAssignmentSync()).catch(()=>{})
  
  /* R2-09: independent foreground team/contact outbox; no navigation/network gate. */
  void import('./features/collaboration').then(({startCollaborationSync})=>startCollaborationSync()).catch(()=>{})

  /* Signed invitation outbox only; recipient PhotoSync reads remain forbidden. */
  void import('./features/photo-grants').then(({startGrantSync})=>startGrantSync()).catch(()=>{})
}
