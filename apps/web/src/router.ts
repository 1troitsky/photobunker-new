import { createRouter, createWebHistory } from 'vue-router'
import FoundationView from './features/foundation/ui/FoundationView.vue'
import { assignmentReleaseUrl } from './features/assignment-release'

const WelcomeView = () => import('./features/ui-preview/ui/WelcomeView.vue')
const IdentityPage = () => import('./features/identity/ui/IdentityPage.vue')
const AppShell = () => import('./features/ui-preview/ui/AppShell.vue')
const MainScreens = () => import('./features/ui-preview/ui/MainScreens.vue')
const LocalPhotoViewer = () => import('./features/camera/ui/LocalPhotoViewer.vue')

/* Shell always opens without blocking HTTP; Identity v2 is initialized lazily. */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/welcome' },
    { path: '/welcome', name: 'welcome', component: WelcomeView },
    { path: '/account/create', name: 'account-create', component: IdentityPage },
    { path: '/account/restore', name: 'account-restore', component: IdentityPage },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: 'photos', name: 'photos', component: MainScreens },
        { path: 'photos/:photoId', name: 'local-photo-viewer', component: LocalPhotoViewer, props: true },
        { path: 'camera', name: 'camera', component: MainScreens },
        { path: 'assignments', name: 'assignments', component: MainScreens },
        { path: 'browser', name: 'browser', component: MainScreens },
        { path: 'profile', name: 'profile', component: MainScreens },
        { path: 'editor/preview', name: 'editor-preview', component: MainScreens },
        { path: 'photo-card/preview', name: 'photo-card-preview', component: MainScreens },
        { path: 'pin/preview', name: 'pin-preview', component: MainScreens },
      ],
    },
    { path: '/foundation', name: 'foundation', component: FoundationView },
    { path: '/:pathMatch(.*)*', redirect: '/welcome' },
  ],
})

// Assignment Release uses exactly one Identity/crypto realm. PB2 pages must not
// run alongside legacy authenticated pages in the same user journey.
router.beforeEach(to => {
  const destination = assignmentReleaseUrl(to.path)
  if (destination) {
    window.location.assign(destination)
    return false
  }
})
