<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import ParticipantsEditor from '../components/ParticipantsEditor.vue'
import { clone, type Team } from '../studio/model'
import { loadStudio, localTasks, cachedTeamTasks, teams, saveTeam, pendingTeamIds, teamSyncErrors, flushPendingTeams } from '../studio/store'
import { account } from '../identity/store'
import { respond } from '../workspace/api'
import { workspaceError } from '../workspace/errors'
import { w } from '../workspace/text'
import { s } from '../studio/text'
import { teamText as t } from '../studio/team-text'
import { teamProfilePath, visibleTeamTasks, teamMembers } from '../studio/team-profile'

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
const pending = computed(() => pendingTeamIds.value.includes(teamId.value))
const failedSync = computed(() => teamSyncErrors.value.includes(teamId.value))
const draft = ref<Team>(), busy = ref(false), loading = ref(true), error = ref(''), copied = ref(false)
let loadEpoch = 0
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
  copied.value = false
  void refresh()
})
function edit() {
  if (!isOwner.value || !team.value) return
  draft.value = clone(team.value)
  error.value = ''
}
function close() { if (!busy.value) draft.value = undefined }
async function save() {
  if (!draft.value || busy.value || !isOwner.value) return
  const currentOwner = account.value?.id, id = teamId.value
  busy.value = true
  error.value = ''
  try {
    const saved = await saveTeam(draft.value)
    if (currentOwner !== account.value?.id || id !== teamId.value) return
    if (saved.id === id) draft.value = undefined
  } catch (failure) {
    if (currentOwner === account.value?.id && id === teamId.value) error.value = workspaceError(failure)
  } finally { busy.value = false }
}
async function retry() {
  error.value = ''
  await flushPendingTeams()
  if (failedSync.value) error.value = t('syncFailed')
}
async function copy() {
  if (!team.value) return
  try {
    await navigator.clipboard.writeText(new URL(teamProfilePath(team.value.id), location.origin).href)
    copied.value = true
  } catch { error.value = t('copyFailed') }
}
async function leave() {
  const member = team.value?.participants.find(item => item.id === account.value?.publicId)
  if (!member?.invitationId || busy.value || !confirm(t('leaveConfirm'))) return
  const owner = account.value?.id
  busy.value = true
  try {
    await respond(member.invitationId, false)
    if (owner === account.value?.id) {
      await loadStudio()
      await router.replace('/profile/teams')
    }
  } catch (failure) { if (owner === account.value?.id) error.value = workspaceError(failure) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="native-screen team-profile-screen">
    <ScreenHeader :title="team?.name || t('teamProfile')" back="/profile/teams">
      <button v-if="team" type="button" class="app-icon-button"
        :aria-label="t('copy')" @click="copy"><AppIcon name="share" /></button>
    </ScreenHeader>
    <div class="screen-body team-profile-body">
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <p v-if="loading && !team" role="status" class="field-hint">{{ t('loading') }}</p>
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
            <h2>{{ team.name }}</h2>
            <p class="field-hint">{{ t('privateOnly') }}</p>
            <p v-if="team.description" class="team-profile-description">{{ team.description }}</p>
            <p v-else class="field-hint">{{ t('noDescription') }}</p>
          </div>
          <div class="inline-actions">
            <button type="button" class="secondary-button" @click="copy">
              <AppIcon name="copy" />{{ copied ? t('copied') : t('copy') }}
            </button>
            <button v-if="isOwner" type="button" class="primary-button" @click="edit">
              <AppIcon name="edit" />{{ t('settings') }}
            </button>
          </div>
          <p v-if="pending" class="field-hint" role="status">{{ failedSync ? t('syncFailed') : t('savedLocally') }}
            <button type="button" class="quiet-button" :disabled="busy" @click="retry">{{ w('retry') }}</button>
          </p>
        </section>
        <section class="form-card">
          <h2>{{ t('creator') }}</h2>
          <p>{{ team.ownerPublicId || t('creatorUnknown') }}</p>
        </section>
        <section class="form-card">
          <h2>{{ s('participants') }} · {{ members.length }}</h2>
          <div v-for="member in members" :key="member.id" class="participant-row">
            <span class="person-avatar" aria-hidden="true"><AppIcon name="user" /></span>
            <span><strong>{{ member.name || member.id }}</strong>
              <small>{{ member.role === 'owner' ? s('owner') : s(member.role) }}
                <template v-if="member.state && member.state !== 'accepted'"> · {{ w(member.state) }}</template>
              </small>
            </span>
          </div>
          <p v-if="!members.length" class="field-hint">{{ t('noMembers') }}</p>
          <p v-if="isOwner" class="field-hint">{{ w('inviteHint') }}</p>
          <button v-if="isOwner" type="button" class="secondary-button" @click="edit">{{ t('manageMembers') }}</button>
          <button v-else-if="team.participants.some(item => item.id === account?.publicId && item.invitationId)"
            type="button" class="quiet-button" :disabled="busy" @click="leave">{{ w('leave') }}</button>
        </section>
        <section class="form-card">
          <h2>{{ t('assignments') }} · {{ tasks.length }}</h2>
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
        <p class="field-hint">{{ t('noChat') }}</p>
      </template>
    </div>
    <AppSheet :open="!!draft" :title="t('settings')" :busy="busy" @close="close">
      <form v-if="draft" class="native-form" @submit.prevent="save">
        <label>{{ s('name') }}<input v-model="draft.name" maxlength="80" required :disabled="busy" /></label>
        <label>{{ t('description') }}<textarea v-model="draft.description" maxlength="1000" rows="4" :disabled="busy" /></label>
        <h2>{{ s('participants') }}</h2>
        <ParticipantsEditor v-model="draft.participants" :owner-public-id="draft.ownerPublicId"
          :read-only="busy" :invitations="true" />
        <p class="field-hint">{{ w('inviteHint') }}</p>
        <button type="submit" class="primary-button full-button" :disabled="busy">{{ s('save') }}</button>
      </form>
    </AppSheet>
  </section>
</template>
