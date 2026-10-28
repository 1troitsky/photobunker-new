import { createRouter, createWebHistory } from 'vue-router'
import FoundationView from './features/foundation/ui/FoundationView.vue'

const WelcomeView = () => import('./features/ui-preview/ui/WelcomeView.vue')
const AccountPreviewView = () => import('./features/ui-preview/ui/AccountPreviewView.vue')
const AppShell = () => import('./features/ui-preview/ui/AppShell.vue')
const MainScreens = () => import('./features/ui-preview/ui/MainScreens.vue')

/* UI-only canonical routes. No network/auth/store guards or startup hooks. */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/welcome' },
    { path: '/welcome', name: 'welcome', component: WelcomeView },
    { path: '/account/create', name: 'account-create-preview', component: AccountPreviewView },
    { path: '/account/restore', name: 'account-restore-preview', component: AccountPreviewView },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: 'photos', name: 'photos', component: MainScreens },
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
