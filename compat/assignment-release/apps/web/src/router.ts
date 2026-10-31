import { createRouter, createWebHistory } from 'vue-router'
import type { RouterHistory } from 'vue-router'
import SharedPhotoView from './views/SharedPhotoView.vue'
import SharedCardView from './views/SharedCardView.vue'
import WelcomeView from './views/WelcomeView.vue'
import AccountAuthView from './views/AccountAuthView.vue'
import AccountEditView from './views/AccountEditView.vue'
import ContactsView from './views/ContactsView.vue'
import PersonProfileView from './views/PersonProfileView.vue'
const CompatibilityPhotoBootstrap = () => import('./views/MessagesView.vue')
import PhotoSecurityView from './views/PhotoSecurityView.vue'
import AccountSecurityView from './views/AccountSecurityView.vue'
import CameraView from './views/CameraView.vue'
import GalleryView from './views/GalleryView.vue'
import SettingsView from './views/SettingsView.vue'
import DataStorageView from './views/DataStorageView.vue'
import PhotoView from './views/PhotoView.vue'
import PhotoCardView from './views/PhotoCardView.vue'
import PhotoBrowserIndexView from './views/PhotoBrowserIndexView.vue'
import PhotoBrowserView from './views/PhotoBrowserView.vue'
import ProfilesView from './views/ProfilesView.vue'
import ProfileEditView from './views/ProfileEditView.vue'
import TeamView from './views/TeamView.vue'
import JoinView from './views/JoinView.vue'
import AssignmentsView from './views/AssignmentsView.vue'
import AssignmentView from './views/AssignmentView.vue'
import UserProfileView from './views/UserProfileView.vue'
import { account, sessionState, offlineCaptureIdentity, hasConfirmedIdentity } from './identity/store'
import { launchPath } from './app/preferences'
import { profileReturnTo } from './identity/person'
import AssignmentEditView from './views/AssignmentEditView.vue'
import TeamsView from './views/TeamsView.vue'
import TeamProfileView from './views/TeamProfileView.vue'
import PhotoEditView from './views/PhotoEditView.vue'

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
      { path: '/profile/teams', name: 'teams', component: TeamsView },
      { path: '/profile/teams/:id', name: 'team-profile', component: TeamProfileView },
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
      { path: '/gallery/:id/card', name: 'photo-card', component: PhotoCardView },
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
