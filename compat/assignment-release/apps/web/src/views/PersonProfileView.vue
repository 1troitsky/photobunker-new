<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { account, type Person, type ProfileField } from '../identity/store'
import { identityRequest, IdentityError } from '../identity/api'
import { profilePath } from '../identity/person'
import { personText as text } from '../identity/person-text'
import { a } from '../identity/text'
import { s } from '../studio/text'
import { ui, initials, avatarColor } from '../messages/presentation'
import { enabled as callsEnabled, phase as callPhase } from '../calls/store'
import { t as callText } from '../calls/text'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import { usePeerPresence } from '../profiles/presence'
import { presenceLabel } from '../profiles/presence-text'
const props = defineProps<{ inMessages?: boolean }>()
const emit = defineEmits<{ message: [id: string]; call: [id: string] }>()
const route = useRoute(), router = useRouter()
const person = ref<Person>(), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('')
const confirmAction = ref<'remove' | 'block' | ''>(''), shareOpen = ref(false)
const peerPresence = usePeerPresence(computed(() => person.value && !person.value.blocked ? person.value.publicId : ''))
const title = computed(() => person.value?.fields.name || (person.value?.username ? '@' + person.value.username : person.value?.publicId) || text('title'))
const shareUrl = computed(() => person.value ? new URL(profilePath(person.value.publicId), window.location.origin).href : '')
const facts = computed(() => (['email', 'phone', 'links', 'about'] as ProfileField[]).filter(field => person.value?.fields[field]))
let generation = 0, operation = 0
async function refresh(clear = false) {
  const version = ++generation, owner = account.value?.id, handle = String(route.params.handle || '')
  if (clear) { person.value = undefined; notice.value = ''; confirmAction.value = ''; shareOpen.value = false }
  if (!owner) { loading.value = false; return }
  loading.value = true; error.value = ''
  try {
    const found = await identityRequest<Person>(`/people/${encodeURIComponent(handle)}`)
    if (generation === version && account.value?.id === owner) person.value = found
  } catch (failure) {
    if (generation === version && account.value?.id === owner) {
      person.value = undefined
      error.value = failure instanceof IdentityError && failure.status === 404 ? a('notFound') : text('failed')
    }
  } finally { if (generation === version) loading.value = false }
}
watch([() => route.params.handle, () => account.value?.id], () => { operation++; busy.value = false; void refresh(true) }, { immediate: true })
const timer = setInterval(() => { if (!document.hidden && !busy.value && !loading.value && person.value && !confirmAction.value) void refresh() }, 15000)
onBeforeUnmount(() => { generation++; operation++; clearInterval(timer) })
function back() {
  if (props.inMessages) void router.replace('/messages')
  else void router.push(route.query.from === 'contacts' ? '/profile/contacts' : '/messages')
}
function write(call = false) {
  if (!person.value || person.value.self || person.value.blocked || busy.value) return
  if (props.inMessages) { if (call) emit('call', person.value.publicId); else emit('message', person.value.publicId) }
  else void router.push({ path: '/messages', query: { peer: person.value.publicId, ...(call ? { call: 'audio' } : {}) } })
}
async function action(kind: 'add' | 'remove' | 'block' | 'unblock') {
  if (!person.value || busy.value) return
  const value = person.value, owner = account.value?.id, version = generation, actionVersion = ++operation
  busy.value = true; error.value = ''; notice.value = ''
  try {
    if (kind === 'add') await identityRequest('/contacts', 'POST', { publicId: value.publicId })
    else if (kind === 'remove') await identityRequest(`/contacts/${value.relationship!.id}`, 'DELETE')
    else await identityRequest(`/blocks/${encodeURIComponent(value.publicId)}`, kind === 'block' ? 'POST' : 'DELETE')
    if (version !== generation || owner !== account.value?.id) return
    confirmAction.value = ''
    await refresh()
  } catch (failure) {
    if (version === generation && owner === account.value?.id) error.value = failure instanceof IdentityError && failure.status === 429 ? text('rateLimited') : text('actionFailed')
  } finally { if (actionVersion === operation) busy.value = false }
}
async function share() {
  if (!person.value) return
  error.value = ''; notice.value = ''
  if (navigator.share) {
    try { await navigator.share({ title: `PhotoBunker · ${person.value.username ? '@' + person.value.username : person.value.publicId}`, url: shareUrl.value }); return }
    catch (failure) { if (failure instanceof DOMException && failure.name === 'AbortError') return }
  }
  try { await navigator.clipboard.writeText(shareUrl.value); notice.value = text('shared') }
  catch { shareOpen.value = true }
}
</script>
<template>
  <section class="native-screen person-screen" :data-person="person?.publicId" :data-blocked="!!person?.blocked">
    <header class="screen-header"><button class="app-icon-button" :aria-label="s('back')" @click="back"><AppIcon name="back" /></button><div class="screen-title"><h1>{{ text('title') }}</h1></div><button v-if="person" class="app-icon-button" :aria-label="text('share')" @click="share"><AppIcon name="share" /></button></header>
    <div class="screen-body person-body">
      <div v-if="!account" class="native-empty"><AppIcon name="user" /><h2>{{ text('title') }}</h2><p>{{ text('signIn') }}</p><button class="primary-button" @click="router.push({ path: '/profile/account', query: { mode: 'recover', returnTo: profilePath(String(route.params.handle)) } })">{{ a('signIn') }}</button><button class="quiet-button" @click="router.push({ path: '/profile/account', query: { returnTo: profilePath(String(route.params.handle)) } })">{{ a('create') }}</button></div>
      <p v-else-if="loading && !person" class="field-hint" role="status">{{ text('loading') }}</p>
      <template v-else-if="person">
        <div class="person-hero"><span :class="['chat-avatar', 'person-avatar', avatarColor(person.publicId)]">{{ initials(title) }}</span><h2>{{ title }}</h2><p v-if="person.username">@{{ person.username }}</p><p class="person-state presence-label" role="status">{{ presenceLabel(peerPresence) }}</p><p v-if="person.self" class="field-hint">{{ a('self') }}</p><p v-else-if="person.blocked" class="person-state" role="status">{{ text('blocked') }}</p><p v-else-if="person.relationship?.state === 'accepted'" class="person-state">{{ text('added') }}</p></div>
        <div v-if="!person.self && !person.blocked" class="person-main-actions"><button class="primary-button" :disabled="busy" @click="write()"><AppIcon name="messages" />{{ ui('write') }}</button><button class="secondary-button" :disabled="busy || (inMessages && (!callsEnabled || callPhase !== 'idle'))" @click="write(true)"><AppIcon name="phone" />{{ callText('audio') }}</button></div>
        <p v-if="inMessages && !person.self && !person.blocked && !callsEnabled" class="field-hint">{{ ui('callsUnavailable') }}</p>
        <p v-else-if="inMessages && !person.self && !person.blocked && callPhase !== 'idle'" class="field-hint">{{ callText('busy') }}</p>
        <div class="native-card person-information"><dl class="native-facts"><div><dt>{{ text('id') }}</dt><dd class="person-id">{{ person.publicId }}</dd></div><div v-for="field in facts" :key="field"><dt>{{ a(field) }}</dt><dd>{{ person.fields[field] }}</dd></div></dl><p v-if="!facts.length && !person.fields.name" class="field-hint">{{ text('noInfo') }}</p><p class="field-hint">{{ text('privacy') }}</p></div>
        <div class="native-card person-menu">
          <button class="messenger-action" :disabled="busy" @click="share"><AppIcon name="share" />{{ text('share') }}</button>
          <button v-if="person.self" class="messenger-action" @click="router.push('/profile/edit')"><AppIcon name="edit" />{{ a('editProfile') }}</button>
          <template v-else-if="person.blocked"><button class="messenger-action" :disabled="busy" @click="action('unblock')"><AppIcon name="lock" />{{ a('unblock') }}</button></template>
          <template v-else>
            <button v-if="person.relationship?.state === 'accepted'" class="messenger-action" :disabled="busy" @click="confirmAction = 'remove'"><AppIcon name="users" />{{ a('remove') }}</button>
            <button v-else class="messenger-action" :disabled="busy" @click="action('add')"><AppIcon name="plus" />{{ text('add') }}</button>
            <button class="messenger-action subtle-danger" :disabled="busy" @click="confirmAction = 'block'"><AppIcon name="lock" />{{ a('block') }}</button>
          </template>
        </div>
        <p v-if="notice" class="field-hint" role="status">{{ notice }}</p>
      </template>
      <div v-if="error" class="person-error" role="alert"><p class="form-error">{{ error }}</p><button v-if="!person" class="quiet-button" @click="refresh(true)">{{ text('retry') }}</button></div>
    </div>
    <AppSheet :open="!!confirmAction" :title="text(confirmAction === 'block' ? 'blockQuestion' : 'removeQuestion')" :busy="busy" @close="confirmAction = ''"><p>{{ text(confirmAction === 'block' ? 'blockHint' : 'removeHint') }}</p><button class="danger-button" :disabled="busy" @click="action(confirmAction as 'block' | 'remove')">{{ a(confirmAction === 'block' ? 'block' : 'remove') }}</button><p v-if="error" class="form-error" role="alert">{{ error }}</p></AppSheet>
    <AppSheet :open="shareOpen" :title="text('share')" @close="shareOpen = false"><p>{{ text('shareHint') }}</p><label class="native-form">{{ text('shareLink') }}<input readonly :value="shareUrl" @focus="($event.target as HTMLInputElement).select()" /></label></AppSheet>
  </section>
</template>
