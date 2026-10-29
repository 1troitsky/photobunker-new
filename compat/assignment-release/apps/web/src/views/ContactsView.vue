<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import {
  account,
  loadIdentity,
  type Person,
} from '../identity/store'
import { identityRequest, IdentityError } from '../identity/api'
import { a } from '../identity/text'
import { s } from '../studio/text'
import { m } from '../messages/text'
import { initials, avatarColor } from '../messages/presentation'
const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{ profile: [publicId: string] }>()
function openProfile(publicId: string) {
  if (props.embedded) emit('profile', publicId)
  else void router.push({ path: `/people/${encodeURIComponent(publicId)}`, query: { from: 'contacts' } })
}
const router = useRouter()
const contacts = ref<Person[]>([]),
  blocked = ref<string[]>([]),
  query = ref(''),
  tab = ref('contacts'),
  busy = ref(false),
  error = ref('')
const visible = computed(() =>
  contacts.value
    .filter(
      (person) =>
        !query.value ||
        [
          person.publicId,
          person.username,
          person.fields.name,
          person.fields.username,
        ].some((v) =>
          v
            ?.toLocaleLowerCase()
            .includes(query.value.toLocaleLowerCase().replace(/^@/, '')),
        ),
    ),
)
function contactName(person: Person) {
  return person.fields.name || (person.username ? '@' + person.username : person.fields.username || person.publicId)
}
function contactSecondary(person: Person) {
  const value = person.username ? '@' + person.username : person.publicId
  return value === contactName(person) ? '' : value
}
async function refresh() {
  const owner = account.value?.id
  if (!owner) return
  const data = await identityRequest<{ contacts: Person[]; blocked: string[] }>(
    '/contacts',
  )
  if (owner !== account.value?.id) return
  contacts.value = data.contacts
  blocked.value = data.blocked
}
let poll: ReturnType<typeof setInterval>
function sync() {
  if (account.value && document.visibilityState === 'visible')
    void refresh().catch(() => {})
}
onBeforeUnmount(() => {
  clearInterval(poll)
  window.removeEventListener('focus', sync)
  window.removeEventListener('online', sync)
})
onMounted(() => {
  poll = setInterval(sync, 15000)
  window.addEventListener('focus', sync)
  window.addEventListener('online', sync)
})
onMounted(async () => {
  await loadIdentity()
  if (account.value)
    try {
      await refresh()
    } catch {
      error.value = a('failed')
    }
})
watch(
  () => account.value?.id,
  (id, previous) => {
    if (previous && id !== previous) {
      contacts.value = []
      blocked.value = []
      query.value = ''
    }
    if (id && id !== previous)
      void refresh().catch(() => {
        error.value = a('failed')
      })
  },
)
async function find() {
  if (!query.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const owner = account.value?.id
    const found = await identityRequest<Person>(
      `/people/${encodeURIComponent(query.value.trim())}`,
    )
    if (owner === account.value?.id) openProfile(found.publicId)
  } catch (failure) {
    error.value = a(
      failure instanceof IdentityError && failure.status === 404
        ? 'notFound'
        : 'failed',
    )
  } finally {
    busy.value = false
  }
}
async function unblock(value: string) {
  if (!value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await identityRequest(`/blocks/${encodeURIComponent(value)}`, 'DELETE')
    await refresh()
  } catch {
    error.value = a('failed')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section :class="embedded ? 'messenger-contacts' : 'native-screen contacts-screen'">
    <ScreenHeader v-if="!embedded" :title="a('contacts')" back="/profile" />
    <div :class="embedded ? 'contact-body' : 'screen-body'">
      <template v-if="account"
        ><form class="native-form contact-search" @submit.prevent="find">
          <label
            ><span :class="{ 'contact-search-label': embedded }">{{ a('search') }}</span><input
              v-model="query"
              :aria-label="a('search')"
              :placeholder="m('contactPlaceholder')"
              autocapitalize="off"
              spellcheck="false"
              maxlength="64" /></label
          ><button :class="embedded ? 'app-icon-button' : 'primary-button'" :aria-label="s('search')" :disabled="busy || !query.trim()">
            <AppIcon name="search" /><span v-if="!embedded">{{ s('search') }}</span>
          </button>
        </form>
        <p v-if="!embedded" class="field-hint">{{ a('searchHint') }}</p>
        <div class="list-segments contact-tabs">
          <button
            v-for="value in ['contacts', 'blocked'] as const"
            :key="value"
            :aria-pressed="tab === value"
            @click="tab = value"
          >
            {{ a(value) }}
          </button>
        </div>
        <template v-if="tab === 'blocked'"
          ><div v-for="id in blocked" :key="id" class="participant-row">
            <span>{{ id }}</span
            ><button
              class="quiet-button"
              :disabled="busy"
              @click="unblock(id)"
            >
              {{ a('unblock') }}
            </button>
          </div></template
        ><template v-else
          ><button
            v-for="item in visible"
            :key="item.publicId"
            class="picker-row contact-person-row"
            @click="openProfile(item.publicId)"
          >
            <span :class="['chat-avatar', avatarColor(item.publicId)]">{{ initials(item.fields.name || item.username || item.publicId) }}</span
            ><span class="contact-person-copy"
              ><strong>{{ contactName(item) }}</strong
              ><small v-if="contactSecondary(item)">{{ contactSecondary(item) }}</small></span
            ><AppIcon name="chevron" />
          </button>
          <div v-if="!visible.length" class="native-empty">
            <AppIcon name="users" />
            <h2>{{ a('emptyContacts') }}</h2>
          </div></template
        ></template
      >
      <p v-else class="field-hint">{{ a('noAccount') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>
