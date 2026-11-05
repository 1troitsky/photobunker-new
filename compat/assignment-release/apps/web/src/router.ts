import { createRouter, createWebHistory } from 'vue-router'
import type { RouterHistory } from 'vue-router'
import { account, sessionState, offlineCaptureIdentity, hasConfirmedIdentity } from './identity/store'
import { launchPath } from './app/preferences'
import { profileReturnTo } from './identity/person'

// Route-level chunks keep camera, editor, Browser and compatibility messaging
// out of the first render. The shell and dock can paint without waiting for
// Matrix, image editors or collection export code.
const SharedPhotoView = () => import('./views/SharedPhotoView.vue')
const SharedCardView = () => import('./views/SharedCardView.vue')
const WelcomeView = () => import('./views/WelcomeView.vue')
const AccountAuthView = () => import('./views/AccountAuthView.vue')
const AccountEditView = () => import('./views/AccountEditView.vue')
const ContactsView = () => import('./views/ContactsView.vue')
const PersonProfileView = () => import('./views/PersonProfileView.vue')
const CompatibilityPhotoBootstrap = () => import('./views/MessagesView.vue')
const PhotoSecurityView = () => import('./views/PhotoSecurityView.vue')
const AccountSecurityView = () => import('./views/AccountSecurityView.vue')
const CameraView = () => import('./views/CameraView.vue')
const GalleryView = () => import('./views/GalleryView.vue')
const SettingsView = () => import('./views/SettingsView.vue')
const DataStorageView = () => import('./views/DataStorageView.vue')
const PhotoView = () => import('./views/PhotoView.vue')
const PhotoCardView = () => import('./views/PhotoCardView.vue')
const PhotoBrowserIndexView = () => import('./views/PhotoBrowserIndexView.vue')
const PhotoBrowserView = () => import('./views/PhotoBrowserView.vue')
const ProfilesView = () => import('./views/ProfilesView.vue')
const ProfileEditView = () => import('./views/ProfileEditView.vue')
const TeamView = () => import('./views/TeamView.vue')
const JoinView = () => import('./views/JoinView.vue')
const AssignmentsView = () => import('./views/AssignmentsView.vue')
const AssignmentView = () => import('./views/AssignmentView.vue')
const UserProfileView = () => import('./views/UserProfileView.vue')
const AssignmentEditView = () => import('./views/AssignmentEditView.vue')
const TeamsView = () => import('./views/TeamsView.vue')
const PeopleView = () => import('./views/PeopleView.vue')
const TeamProfileView = () => import('./views/TeamProfileView.vue')
const PhotoEditView = () => import('./views/PhotoEditView.vue')
const StatusView = () => import('./views/StatusView.vue')
const PaymentView = () => import('./views/PaymentView.vue')

// Warm the five dock destinations after the first paint. Navigation remains
// local and synchronous even on a high-latency mobile connection; none of
// these imports starts a server request or reads private data.
export function warmPrimaryRoutes() {
  const connection = Reflect.get(navigator, 'connection') as { saveData?: boolean } | undefined
  // Parsing all dock chunks in parallel caused a severe CPU/memory spike on
  // older phones. The service worker still caches production assets; runtime
  // parsing is deliberately staggered and skipped on constrained devices.
  if (connection?.saveData || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4))
    return Promise.resolve([])
  const pause = () => new Promise<void>(resolve => {
    const idle = Reflect.get(window, 'requestIdleCallback') as
      | ((callback: () => void, options?: { timeout: number }) => number)
      | undefined
    if (idle) idle(resolve, { timeout: 2500 })
    else setTimeout(resolve, 1400)
  })
  return (async () => {
    const results: PromiseSettledResult<unknown>[] = []
    for (const load of [AssignmentsView, PhotoBrowserIndexView, CameraView, PeopleView, UserProfileView]) {
      await pause()
      if (document.visibilityState !== 'visible') break
      try { results.push({ status: 'fulfilled', value: await load() }) }
      catch (reason) { results.push({ status: 'rejected', reason }) }
    }
    return results
  })()
}

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/s/:id', name: 'shared-photo', component: SharedPhotoView },
      { path: '/c/:id', name: 'shared-card', component: SharedCardView },
      { path: '/', redirect: () => hasConfirmedIdentity() ||
        (offlineCaptureIdentity.value && !!account.value) ? launchPath() : '/welcome' },
      { path: '/welcome', name: 'welcome', component: WelcomeView },
      {
        path: '/profile/account',
        name: 'account-auth',
        component: AccountAuthView,
      },
      {
        path: '/profile/edit',
        name: 'account-edit',
        component: AccountEditView,
      },
      { path: '/profile/contacts', name: 'contacts', component: ContactsView },
      {
        path: '/profile/photos-security',
        name: 'photo-security',
        component: PhotoSecurityView,
      },
      {
        path: '/profile/security',
        name: 'account-security',
        component: AccountSecurityView,
      },
      { path: '/profile', name: 'profile', component: UserProfileView },
      { path: '/status', name: 'status', component: StatusView },
      { path: '/payment', name: 'payment', component: PaymentView },
      { path: '/profile/teams', name: 'teams', component: TeamsView },
      { path: '/profile/teams/:id', name: 'team-profile', component: TeamProfileView },
      { path: '/people', name: 'people', component: PeopleView },
      // Messenger is unavailable in Assignment Release. Matrix is retained only as a
      // compatibility dependency for the old account/security lifecycle.
      { path: '/messages', redirect: '/assignments' },
      // The old photo-key enrollment is still coupled to the Matrix setup UI.
      // Do not link this internal route from any user-facing navigation.
      { path: '/_compat/photo-bootstrap', name:'messages', component: CompatibilityPhotoBootstrap },
      { path: '/people/:handle', name: 'person-profile', component: PersonProfileView },
      { path: '/join', name: 'join', component: JoinView },
      {
        path: '/camera/presets/:id/team',
        alias: '/profiles/:id/team',
        name: 'team',
        component: TeamView,
      },
      { path: '/assignments', name: 'assignments', component: AssignmentsView },
      {
        path: '/assignments/new',
        name: 'assignment-new',
        component: AssignmentEditView,
      },
      {
        path: '/assignments/:id/edit',
        name: 'assignment-edit',
        component: AssignmentEditView,
      },
      {
        path: '/assignments/:id',
        name: 'assignment',
        component: AssignmentView,
      },
      { path: '/camera', name: 'camera', component: CameraView },
      {
        path: '/camera/presets',
        alias: '/profiles',
        name: 'profiles',
        component: ProfilesView,
      },
      {
        path: '/camera/presets/:id',
        alias: '/profiles/:id',
        name: 'profile-edit',
        component: ProfileEditView,
      },
      { path: '/browser', name: 'photo-browser-new', component: PhotoBrowserIndexView },
      { path: '/browser/:id', name: 'photo-browser', component: PhotoBrowserView },
      { path: '/gallery', name: 'gallery', component: GalleryView },
      {
        path: '/gallery/:id/edit',
        name: 'photo-editor',
        component: PhotoEditView,
      },
      {
        path: '/photo-cards/:id',
        alias: '/gallery/:id/card',
        name: 'photo-card',
        component: PhotoCardView,
      },
      { path: '/gallery/:id', name: 'photo', component: PhotoView },
      { path: '/settings', name: 'settings', component: SettingsView },
      { path: '/settings/data', name: 'data-storage', component: DataStorageView },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })
  // Guard decisions are synchronous. App.vue keeps private views unmounted
  // while the background server/device proof is still unresolved.
  router.beforeEach((to) => {
    if (to.name === 'welcome') {
      // A recognized account never sees the guest landing as its home.
      // Local scoped capture cannot authorize a server API call here.
      if (hasConfirmedIdentity() ||
          (offlineCaptureIdentity.value && !!account.value &&
            ['checking', 'offline'].includes(sessionState.value)))
        return { path: launchPath(), replace: true }
      return
    }
    if (['shared-photo', 'shared-card', 'profile', 'account-auth', 'person-profile'].includes(String(to.name))) return
    if (sessionState.value === 'signed-out' || sessionState.value === 'revoked') {
      const intended = profileReturnTo(to.path)
      return { path: '/profile', query: intended === '/profile' ? {} : { returnTo: intended }, replace: true }
    }
  })
  return router
}
