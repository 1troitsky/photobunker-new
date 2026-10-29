<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSheet from './AppSheet.vue'
import AppIcon from './AppIcon.vue'
import ParticipantsEditor from './ParticipantsEditor.vue'
import { saveTeam, teams } from '../studio/store'
import { clone, type Team } from '../studio/model'
import { WorkspaceConflict } from '../studio/repository'
import { account } from '../identity/store'
import { workspaceError } from '../workspace/errors'
import { s } from '../studio/text'
const props = defineProps<{
  open: boolean
  selectedId?: string
  editId?: string
}>()
const emit = defineEmits<{ close: []; clear: []; pick: [team: Team] }>()
const editing = ref(false),
  busy = ref(false),
  error = ref('')
const draft = ref<Team>({ id: '', name: '', participants: [], revision: 0 })
let initial = ''
function edit(team?: Team) {
  draft.value = team
    ? clone(team)
    : {
        id: crypto.randomUUID(),
        name: `${s('team')} ${teams.value.length + 1}`,
        participants: [],
        revision: 0,
      }
  initial = JSON.stringify(draft.value)
  editing.value = true
  error.value = ''
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      const team = teams.value.find((team) => team.id === props.editId)
      editing.value = false
      if (team) edit(team)
    }
  },
)
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const team = await saveTeam(draft.value)
    emit('pick', clone(team))
    emit('close')
    editing.value = false
  } catch (failure) {
    error.value = account.value
      ? workspaceError(failure)
      : s(failure instanceof WorkspaceConflict ? 'conflict' : 'failed')
  } finally {
    busy.value = false
  }
}
watch(
  () => account.value?.id,
  () => {
    editing.value = false
    draft.value = { id: '', name: '', participants: [], revision: 0 }
    emit('close')
  },
)
function close() {
  if (busy.value) return
  if (
    editing.value &&
    JSON.stringify(draft.value) !== initial &&
    !confirm(s('leave'))
  )
    return
  editing.value = false
  emit('close')
}
</script>
<template>
  <AppSheet
    :open="open"
    :title="
      s(editing ? (draft.revision ? 'editTeam' : 'createTeam') : 'chooseTeam')
    "
    :busy="busy"
    @close="close"
  >
    <form v-if="editing" class="native-form" @submit.prevent.stop="save">
      <label
        >{{ s('name') }}<input v-model="draft.name" required maxlength="80"
      /></label>
      <ParticipantsEditor v-model="draft.participants" />
      <p class="field-hint">{{ s('teamSnapshot') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="primary-button full-button" :disabled="busy">
        {{ s('save') }}
      </button>
    </form>
    <template v-else>
      <button
        type="button"
        class="picker-row"
        @click="
          () => {
            emit('clear')
            emit('close')
          }
        "
      >
        <span>{{ s('noTeam') }}</span
        ><AppIcon v-if="!selectedId" name="check" />
      </button>
      <div v-if="!teams.length" class="compact-empty">{{ s('noTeams') }}</div>
      <div v-for="team in teams" :key="team.id" class="team-picker-row">
        <button
          type="button"
          class="picker-row"
          :aria-pressed="selectedId === team.id"
          @click="
            () => {
              emit('pick', clone(team))
              emit('close')
            }
          "
        >
          <span class="person-avatar"><AppIcon name="users" /></span
          ><span
            ><strong>{{ team.name }}</strong
            ><small
              >{{ s('participants') }} ·
              {{ team.participants.length + 1 }}</small
            ></span
          ><AppIcon :name="selectedId === team.id ? 'check' : 'chevron'" />
        </button>
        <button
          v-if="team.canManage !== false"
          type="button"
          class="app-icon-button"
          :aria-label="`${s('editTeam')}: ${team.name}`"
          @click="edit(team)"
        >
          <AppIcon name="edit" />
        </button>
      </div>
      <button type="button" class="row-add" @click="edit()">
        <AppIcon name="plus" />{{ s('createTeam') }}
      </button>
    </template>
  </AppSheet>
</template>
