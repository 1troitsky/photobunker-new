import { createRouter, createWebHistory } from 'vue-router'
import FoundationView from './features/foundation/ui/FoundationView.vue'
import { assignmentReleaseUrl } from './features/assignment-release'

const WelcomeView = () => import('./features/ui-preview/ui/WelcomeView.vue')
const IdentityPage = () => import('./features/identity/ui/IdentityPage.vue')
const AppShell = () => import('./features/ui-preview/ui/AppShell.vue')
const MainScreens = () => import('./features/ui-preview/ui/MainScreens.vue')
const LocalPhotoViewer = () => import('./features/camera/ui/LocalPhotoViewer.vue')
const PrivateCardScreen = () => import('./features/photo-card/ui/PrivateCardScreen.vue')
const BrowserScreen = () => import('./features/photo-browser/ui/BrowserScreen.vue')
const EditorScreen = () => import('./features/editor/ui/EditorScreen.vue')
const AssignmentsScreen = () => import('./features/assignments/ui/AssignmentsScreen.vue')
const CollaborationScreen = () => import('./features/collaboration/ui/CollaborationScreen.vue')
const PhotoReviewScreen = () => import('./features/photo-review/ui/ReviewScreen.vue')

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
        { path: 'photos/:photoId/review', name: 'photo-review', component: PhotoReviewScreen },
        { path: 'photos/:photoId/edit', name: 'photo-editor', component: EditorScreen },
        { path: 'photos/:photoId/card', name: 'private-photo-card', component: PrivateCardScreen },
        { path: 'camera', name: 'camera', component: MainScreens },
        { path: 'assignments', name: 'assignments', component: AssignmentsScreen },
        { path: 'assignments/new', name: 'assignment-new', component: AssignmentsScreen },
        { path: 'assignments/:assignmentId', name: 'assignment-detail', component: AssignmentsScreen },
        { path: 'assignments/:assignmentId/edit', name: 'assignment-edit', component: AssignmentsScreen },
        { path: 'browser', name: 'browser', component: BrowserScreen },
        { path: 'contacts', name: 'contacts', component: CollaborationScreen },
        { path: 'teams', name: 'teams', component: CollaborationScreen },
        { path: 'teams/:teamId', name: 'team-detail', component: CollaborationScreen },
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

// Compatibility origin is a separate identity/crypto realm. Never initialize
// a PB2 session and legacy authenticated data in the same browser navigation.
router.beforeEach(to => {
  const destination = assignmentReleaseUrl(to.path)
  if (destination) {
    window.location.assign(destination)
    return false
  }
})
