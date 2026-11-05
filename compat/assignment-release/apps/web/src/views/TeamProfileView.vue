<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import ParticipantsEditor from '../components/ParticipantsEditor.vue'
import { clone, type Team } from '../studio/model'
import { loadStudio, localTasks, cachedTeamTasks, teams, saveTeam } from '../studio/store'
import { account } from '../identity/store'
import { respond } from '../workspace/api'
import { workspaceError } from '../workspace/errors'
import { w } from '../workspace/text'
import { s } from '../studio/text'
import { teamText as t } from '../studio/team-text'
import { visibleTeamTasks, teamMembers } from '../studio/team-profile'
import { q } from '../crypto/text'

const route = useRoute(), router = useRouter()
const teamId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const team = computed(() => teams.value.find(value => value.id === teamId.value))
const tasks = computed(() => {
  const available = new Map(cachedTeamTasks.value.map(task => [task.id, task]))
  for (const task of localTasks.value) available.set(task.id, task)
  return visibleTeamTasks([...available.values()], teamId.value)
})
const members = computed(() => teamMembers(team.value))
const isOwner = computed(() => !!team.value && team.value.canManage === true &&
  team.value.ownerPublicId === account.value?.publicId)
const draft = ref<Team>(), busy = ref(false), loading = ref(true), error = ref('')
let loadEpoch = 0, draftSignature = ''
async function refresh() {
  const current = ++loadEpoch
  loading.value = true
  error.value = ''
  try { await loadStudio() }
  catch (failure) {
    if (current === loadEpoch) error.value = workspaceError(failure)
  } finally { if (current === loadEpoch) loading.value = false }
}
onMounted(() => { void refresh() })
watch([teamId, () => account.value?.id], () => {
  loadEpoch++
  draft.value = undefined
  error.value = ''
  void refresh()
})
function edit() {
  if (!isOwner.value || !team.value) return
  draft.value = clone(team.value)
  draftSignature = JSON.stringify(draft.value)
  error.value = ''
}
function close() {
  if (busy.value) return
  draft.value = undefined
  error.value = ''
}
async function save(closeAfter = false) {
  if (!draft.value || !isOwner.value) return
  if (busy.value) return
  if (JSON.stringify(draft.value) === draftSignature) {
    if (closeAfter) draft.value = undefined
    return
  }
  if (!draft.value.name.trim()) { error.value = s('required'); return }
  const currentOwner = account.value?.id, id = teamId.value
  busy.value = true
  error.value = ''
  try {
    const result = await saveTeam(draft.value)
    if (currentOwner !== account.value?.id || id !== teamId.value) return
    if (result.id === id) {
      draft.value = clone(result)
      draftSignature = JSON.stringify(draft.value)
      if (closeAfter) draft.value = undefined
    }
  } catch (failure) {
    if (currentOwner === account.value?.id && id === teamId.value) error.value = workspaceError(failure)
  } finally { busy.value = false }
}
async function leave() {
  const member = team.value?.participants.find(item => item.id === account.value?.publicId)
  if (!member?.invitationId || busy.value || !confirm(t('leaveConfirm'))) return
  const owner = account.value?.id
  busy.value = true
  try {
    await respond(member.invitationId, false)
    if (owner === account.value?.id) {
      await loadStudio(true)
      await router.replace('/profile/teams')
    }
  } catch (failure) { if (owner === account.value?.id) error.value = workspaceError(failure) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="native-screen team-profile-screen">
    <ScreenHeader :title="team?.name || t('teamProfile')" back="/people">
      <button v-if="isOwner" type="button" class="app-icon-button"
        :aria-label="t('settings')" @click="edit"><AppIcon name="settings" /></button>
    </ScreenHeader>
    <div class="screen-body team-profile-body">
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <div v-if="loading && !team" class="app-route-skeleton" role="status" aria-label="Loading">
        <span class="route-skeleton-title" /><span class="route-skeleton-card" /><span class="route-skeleton-card" />
      </div>
      <div v-else-if="!team" class="native-empty">
        <AppIcon name="users" />
        <h2>{{ t('notAvailable') }}</h2>
        <p>{{ t('privateOnly') }}</p>
        <button type="button" class="secondary-button" @click="refresh">{{ w('retry') }}</button>
      </div>
      <template v-else>
        <section class="account-card team-profile-hero">
          <span class="account-avatar team-profile-avatar" aria-hidden="true"><AppIcon name="users" /></span>
          <div class="team-profile-intro">
            <p v-if="team.description" class="team-profile-description">{{ team.description }}</p>
            <p v-else class="field-hint">{{ q('Общая команда для заданий и съёмок') }}</p>
            <p class="field-hint">{{ t('creator') }} · {{ team.ownerPublicId === account?.publicId ? s('you') : q('Владелец команды') }}</p>
          </div>
          <div class="inline-actions">
            <button v-if="isOwner" type="button" class="primary-button" @click="edit">
              <AppIcon name="edit" />{{ t('settings') }}
            </button>
          </div>
        </section>
        <section class="form-card">
          <h2>{{ s('participants') }} · {{ members.length }}</h2>
          <div v-for="member in members" :key="member.id" class="participant-row">
            <span class="person-avatar" aria-hidden="true"><AppIcon name="user" /></span>
            <span><strong>{{ member.role === 'owner' && member.id === account?.publicId ? s('you') : member.name || q('Участник команды') }}</strong>
              <small>{{ member.role === 'owner' ? s('owner') : s(member.role) }}</small>
            </span>
          </div>
          <p v-if="!members.length" class="field-hint">{{ t('noMembers') }}</p>
          <button v-if="isOwner" type="button" class="secondary-button" @click="edit">{{ q('Изменить состав') }}</button>
          <button v-else-if="team.participants.some(item => item.id === account?.publicId && item.invitationId)"
            type="button" class="quiet-button" :disabled="busy" @click="leave">{{ w('leave') }}</button>
        </section>
        <section class="form-card">
          <h2>{{ t('assignments') }}</h2>
          <div v-if="tasks.length" class="team-profile-tasks">
            <RouterLink v-for="task in tasks" :key="task.id" class="account-link"
              :to="'/assignments/' + encodeURIComponent(task.id)">
              <AppIcon name="profiles" /><span><strong>{{ task.name }}</strong>
                <small>{{ task.completed ? t('completed') : t('inProgress') }}</small></span>
              <AppIcon name="chevron" />
            </RouterLink>
          </div>
          <p v-else class="field-hint">{{ t('noAssignments') }}</p>
        </section>
      </template>
    </div>
    <AppSheet :open="!!draft" :title="t('settings')" :busy="busy" @close="close">
      <div v-if="draft" class="native-form">
        <label>{{ s('name') }}<input v-model="draft.name" maxlength="80" required :disabled="busy" /></label>
        <label>{{ t('description') }}<textarea v-model="draft.description" maxlength="1000" rows="4" :disabled="busy" /></label>
        <h2>{{ s('participants') }}</h2>
        <ParticipantsEditor v-model="draft.participants" :owner-public-id="draft.ownerPublicId"
          :read-only="busy" :invitations="true" />
        <p v-if="busy" class="field-hint" role="status">{{ s('saving') }}</p>
        <button type="button" class="primary-button full-button" :disabled="busy" @click="save(true)">{{ s('done') }}</button>
      </div>
    </AppSheet>
  </section>
</template>
