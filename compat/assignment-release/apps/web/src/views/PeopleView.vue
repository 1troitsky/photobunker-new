<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import TeamsView from './TeamsView.vue'
import ContactsView from './ContactsView.vue'
import { a } from '../identity/text'
import { s } from '../studio/text'
import { u } from '../app/text'

const tab = ref<'teams' | 'contacts'>('teams')
const router = useRouter()
function openContact(publicId: string) {
  void router.push({ path: `/people/${encodeURIComponent(publicId)}`, query: { from: 'contacts' } })
}
</script>

<template>
  <section class="native-screen people-screen">
    <ScreenHeader :title="u('people')">
      <RouterLink to="/profile" class="app-icon-button" :aria-label="u('profile')">
        <AppIcon name="user" />
      </RouterLink>
    </ScreenHeader>
    <div class="people-tabs" role="tablist" :aria-label="u('people')">
      <button role="tab" :aria-selected="tab === 'teams'" @click="tab = 'teams'">
        <AppIcon name="users" />{{ s('teams') }}
      </button>
      <button role="tab" :aria-selected="tab === 'contacts'" @click="tab = 'contacts'">
        <AppIcon name="user" />{{ a('contacts') }}
      </button>
    </div>
    <TeamsView v-if="tab === 'teams'" embedded />
    <ContactsView v-else embedded @profile="openContact" />
  </section>
</template>
