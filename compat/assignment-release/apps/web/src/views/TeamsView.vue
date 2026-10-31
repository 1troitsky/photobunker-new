<script setup lang="ts">
import { formatNumber } from '../i18n'
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { teamProfilePath } from '../studio/team-profile'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import ParticipantsEditor from '../components/ParticipantsEditor.vue'
import { clone, type Team } from '../studio/model'
import { loadStudio, removeItem, saveTeam, teams, pendingTeamIds } from '../studio/store'
import { WorkspaceConflict } from '../studio/repository'
import { account } from '../identity/store'
import WorkspaceInvitations from '../components/WorkspaceInvitations.vue'
import { respond } from '../workspace/api'
import { w } from '../workspace/text'
import { workspaceError } from '../workspace/errors'
import { s } from '../studio/text'
const router = useRouter()
const draft = ref<Team>(),
  busy = ref(false),
  error = ref('')
let initial = ''
function edit(team?: Team) {
  // Opening the creation sheet must never wait for an unavailable API.
  if (team && team.accountId !== account.value?.id) return
  draft.value = team
    ? clone(team)
    : {
        id: crypto.randomUUID(),
        name: `${s('team')} ${teams.value.length + 1}`,
        participants: [],
        revision: 0,
      }
  initial = JSON.stringify(draft.value)
  error.value = ''
}
function close() {
  if (
    !busy.value &&
    (JSON.stringify(draft.value) === initial || confirm(s('leave')))
  )
    draft.value = undefined
}
async function save() {
  if (!draft.value || busy.value) return
  busy.value = true
  try {
    const saved = await saveTeam(draft.value)
    draft.value = undefined
    await router.push(teamProfilePath(saved.id))
  } catch (failure) {
    error.value = account.value
      ? workspaceError(failure)
      : s(failure instanceof WorkspaceConflict ? 'conflict' : 'failed')
  } finally {
    busy.value = false
  }
}
async function remove(team: Team) {
  if (!confirm(s('deleteItem'))) return
  try {
    await removeItem('teams', team)
  } catch {
    error.value = s('failed')
  }
}
watch(
  () => account.value?.id,
  () => {
    draft.value = undefined
    error.value = ''
    busy.value = false
  },
)
async function leave() {
  const member = draft.value?.participants.find(
    (person) => person.id === account.value?.publicId,
  )
  if (!member?.invitationId || !confirm(w('leave') + '?')) return
  busy.value = true
  try {
    await respond(member.invitationId, false)
    draft.value = undefined
    await loadStudio()
  } catch (failure) {
    error.value = workspaceError(failure)
  } finally {
    busy.value = false
  }
}
onMounted(loadStudio)
</script>
<template>
  <section class="native-screen">
    <ScreenHeader :title="s('teams')" back="/profile"
      ><button
        class="app-icon-button"
        :aria-label="s('createTeam')"
        @click="edit()"
      >
        <AppIcon name="plus" /></button
    ></ScreenHeader>
    <div class="screen-body">
      <WorkspaceInvitations v-if="account" kind="team" />
      <p v-if="account" class="field-hint">{{ w('teamHint') }}</p>
      <p v-if="error && !draft" class="form-error" role="alert">{{ error }}</p>
      <article v-for="team in teams" :key="team.id" class="preset-tile">
        <button class="preset-tile-main" @click="router.push(teamProfilePath(team.id))">
          <span class="person-avatar"><AppIcon name="users" /></span
          ><span
            ><strong>{{ team.name }}</strong
            ><small
              >{{ s('participants') }} ·
              {{ formatNumber(team.participants.length + 1) }}</small
            ></span
          ></button
        ><button
          v-if="team.canManage !== false"
          class="app-icon-button"
          :aria-label="`${s('editTeam')}: ${team.name}`"
          @click="router.push(teamProfilePath(team.id))"
        >
          <AppIcon name="edit" /></button
        ><button
          v-if="team.canManage !== false && !pendingTeamIds.includes(team.id)"
          class="app-icon-button subtle-danger"
          :aria-label="`${s('remove')}: ${team.name}`"
          @click="remove(team)"
        >
          <AppIcon name="trash" />
        </button>
      </article>
      <div v-if="!teams.length" class="native-empty">
        <AppIcon name="users" />
        <h2>{{ s('noTeams') }}</h2>
        <p>{{ s('teamHint') }}</p>
        <button class="primary-button" @click="edit()">
          {{ s('createTeam') }}
        </button>
      </div>
    </div>
    <AppSheet
      :open="!!draft"
      :title="s(draft?.revision ? 'editTeam' : 'createTeam')"
      :busy="busy"
      @close="close"
      ><form v-if="draft" class="native-form" @submit.prevent="save">
        <label
          >{{ s('name')
          }}<input
            v-model="draft.name"
            :disabled="draft.canManage === false"
            required
            maxlength="80" /></label
        ><label>{{ s('description') }}<textarea v-model="draft.description" maxlength="1000" rows="3" /></label>
        <ParticipantsEditor
          v-model="draft.participants"
          :read-only="draft.canManage === false"
          :owner-public-id="draft.ownerPublicId"
        />
        <p class="field-hint">
          {{ account ? w('inviteHint') : s('localShort') }}
        </p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button
          v-if="draft.canManage === false"
          type="button"
          class="quiet-button subtle-danger"
          :disabled="busy"
          @click="leave"
        >
          {{ w('leave') }}</button
        ><button
          v-if="draft.canManage !== false"
          class="primary-button full-button"
          :disabled="busy"
        >
          {{ s('save') }}
        </button>
      </form></AppSheet
    >
  </section>
</template>
