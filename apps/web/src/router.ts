import { createRouter, createWebHistory } from 'vue-router'

import FoundationView from './features/foundation/ui/FoundationView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'foundation', component: FoundationView },
    { path: '/foundation', redirect: '/' },
  ],
})
