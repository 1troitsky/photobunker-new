<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import FormTabs from '../components/FormTabs.vue'
import ToggleRow from '../components/ToggleRow.vue'
import ParticipantsEditor from '../components/ParticipantsEditor.vue'
import TeamPicker from '../components/TeamPicker.vue'
import AppIcon from '../components/AppIcon.vue'
import {
  asLocalPreset,
  loadStudio,
  localTasks,
  presetChoices,
  saveTask,
  teams,
} from '../studio/store'
import {
  clone,
  lines,
  newTask,
  validateTask,
  type Task,
  type Team,
} from '../studio/model'
import { WorkspaceConflict } from '../studio/repository'
import { assignments, refreshAssignments } from '../collaboration/store'
import { refreshProfiles } from '../profiles/store'
import { account } from '../identity/store'
import { w } from '../workspace/text'
import { workspaceError } from '../workspace/errors'
import { s } from '../studio/text'
const route = useRoute(),
  router = useRouter(),
  draft = ref<Task>(newTask(''))
const tab = ref('basics'),
  ready = ref(false),
  busy = ref(false),
  saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle'),
  error = ref(''),
  teamPicker = ref(false),
  editTeamId = ref('')
const shots = ref(''),
  categories = ref('')
let saveTimer: ReturnType<typeof setTimeout> | undefined,
  saveAgain = false, disposed = false
const fresh = computed(
  () => route.params.id === undefined || route.params.id === 'new',
)
const tabs = computed(() =>
  (['basics', 'captureSettings', 'participants', 'rules'] as const).map(
    (id) => ({ id, label: s(id) }),
  ),
)
function dateValue(time: number | null) {
  if (time === null) return ''
  const date = new Date(time)
  return new Date(time - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
function setDate(field: 'startsAt' | 'finishesAt', event: Event) {
  const value = (event.target as HTMLInputElement).value
  draft.value[field] = value ? new Date(value).getTime() : null
}
const signature = () => {
  const value = clone(draft.value)
  value.revision = 0
  return `${JSON.stringify(value)}|${shots.value}|${categories.value}`
}
const hasDeadline = computed(() => draft.value.finishesAt !== null)
function setDeadline(enabled: boolean) {
  draft.value.finishesAt = enabled
    ? Math.max(Date.now() + 86400000, (draft.value.startsAt ?? Date.now()) + 86400000)
    : null
}
onMounted(async () => {
  await Promise.all([loadStudio(), refreshAssignments(), refreshProfiles()])
  const id = String(route.query.copy ?? (fresh.value ? '' : route.params.id))
  let item = localTasks.value.find((item) => item.id === id)
  if (item) item = clone(item)
  else if (id) {
    const source = assignments.value.find((item) => item.id === id)
    if (source)
      item = {
        ...newTask(source.name),
        instructions: source.instructions,
        finishesAt: source.dueAt,
        presetId: source.profileId,
        preset: asLocalPreset(source.profileId) ?? null,
        targetCount: Math.max(1, source.shots.length),
        shots: clone(source.shots),
        participants: source.assignees.map((id) => ({
          id,
          name: '',
          role: 'contributor' as const,
          notify: false,
        })),
      }
  } else item = newTask(`${s('assignment')} ${localTasks.value.length + 1}`)
  if (item?.accountId && !fresh.value && item.canManage === false) {
    error.value = w('readOnly')
    return
  }
  if (!item) {
    error.value = s('required')
    return
  }
  if (fresh.value && id) {
    item.id = crypto.randomUUID()
    item.revision = 0
    item.createdAt = Date.now()
    item.startsAt = item.createdAt
    item.completed = false
    item.name = `${item.name} (${s('duplicate')})`.slice(0, 80)
    item.participants = item.participants.filter(
      (person) => person.id !== account.value?.publicId,
    )
    item.participants.forEach((person) => {
      person.notify = false
    })
  }
  item.rules.useAssignmentPhotoId ??= true // Old assignments default to shared numbering.
  draft.value = item
  const returnedPreset = typeof route.query.preset === 'string' ? route.query.preset : ''
  if (returnedPreset) {
    const preset = asLocalPreset(returnedPreset)
    if (preset) {
      draft.value.presetId = preset.id
      draft.value.preset = preset
    }
  }
  shots.value = item.shots.join('\n')
  categories.value = item.rules.categories.join('\n')
  ready.value = true
})
function pickPreset(event: Event) {
  draft.value.presetId = (event.target as HTMLSelectElement).value
  draft.value.preset = asLocalPreset(draft.value.presetId) ?? null
}
async function createPreset() {
  // Persist the assignment snapshot before leaving this editor. The preset
  // editor returns with the newly created ID and it is selected immediately.
  if (signature() !== '') await save()
  await router.push({
    path: '/camera/presets/new',
    query: { returnTo: route.path },
  })
}
const selectedTeam = computed(() =>
  teams.value.find((team) => team.id === draft.value.teamId),
)
const selectedTeamName = computed(
  () => draft.value.teamName || selectedTeam.value?.name || s('teamMissing'),
)
function openTeams(edit = false) {
  editTeamId.value = edit ? draft.value.teamId : ''
  teamPicker.value = true
}
function clearTeam() {
  draft.value.teamId = ''
  draft.value.teamName = undefined
}
function pickTeam(team: Team) {
  draft.value.teamId = team.id
  draft.value.teamName = team.name
  draft.value.participants = clone(
    team.participants.filter(
      (person) => !account.value || person.state === 'accepted',
    ),
  ).filter((person) => person.id !== account.value?.publicId)
  draft.value.participants.forEach((person) => {
    person.notify = true
  })
}
function syncShots() {
  draft.value.shots = lines(shots.value)
  draft.value.targetCount = Math.max(
    draft.value.targetCount,
    draft.value.shots.length,
  )
}
function normalizedDraft() {
  const value = clone(draft.value)
  value.shots = lines(shots.value)
  value.rules.categories = value.rules.particularCategory
    ? lines(categories.value)
    : []
  return value
}
function scheduleSave(delay = 550) {
  if (!ready.value || disposed) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = undefined; void save() }, delay)
}
async function save() {
  if (!ready.value || busy.value) return
  const snapshot = normalizedDraft()
  const invalid = validateTask(snapshot)
  if (invalid) {
    saveState.value = 'error'
    error.value = s(
      invalid === 'basics' &&
        snapshot.startsAt !== null &&
        snapshot.finishesAt !== null &&
        snapshot.finishesAt <= snapshot.startsAt
        ? 'datesInvalid'
        : 'required',
    )
    return
  }
  const actor = account.value?.id
  busy.value = true
  saveState.value = 'saving'
  error.value = ''
  const savingSignature = signature()
  try {
    const item = await saveTask(snapshot)
    if (actor !== account.value?.id) return
    // Keep edits made while the request was in flight; only advance the
    // optimistic revision required by the next background save.
    draft.value.revision = item.revision
    draft.value.id = item.id
    saveState.value = 'saved'
    if (fresh.value) await router.replace(`/assignments/${item.id}/edit`)
    if (signature() !== savingSignature || saveAgain) {
      saveAgain = false
      scheduleSave(80)
    }
  } catch (failure) {
    saveState.value = 'error'
    error.value = account.value
      ? workspaceError(failure)
      : s(failure instanceof WorkspaceConflict ? 'conflict' : 'failed')
  } finally {
    busy.value = false
  }
}
watch(signature, () => {
  if (!ready.value) return
  error.value = ''
  saveState.value = 'idle'
  if (busy.value) saveAgain = true
  else scheduleSave()
})
watch(
  () => account.value?.id,
  (id, previous) => {
    if (previous && id !== previous) {
      ready.value = false
      draft.value = newTask('')
      void router.replace('/assignments')
    }
  },
)
onBeforeUnmount(() => {
  disposed = true
  if (saveTimer) clearTimeout(saveTimer)
  // The current save already owns an immutable snapshot. Never display a
  // leave confirmation; valid edits are normally committed by the debounce.
})
</script>
<template>
  <section class="native-screen native-editor assignment-editor">
    <ScreenHeader
      :title="s(fresh ? 'newAssignment' : 'editAssignment')"
      :back="fresh ? '/assignments' : `/assignments/${route.params.id}`"
      :subtitle="ready ? s(saveState === 'saving' ? 'saving' : saveState === 'saved' ? 'saved' : 'saveAutomatically') : undefined"
    /><template v-if="ready"
      ><FormTabs v-model="tab" :items="tabs" />
      <form class="native-form editor-body" @submit.prevent="save">
        <div v-show="tab === 'basics'" class="form-section">
          <label
            >{{ s('name')
            }}<input
              v-model="draft.name"
              maxlength="80"
              :aria-label="s('name')" /></label
          ><label
            >{{ s('instructions')
            }}<textarea
              v-model="draft.instructions"
              maxlength="4000"
              rows="4"
              :placeholder="s('optional')"
            />
          </label>
          <div class="two-fields">
            <label
              >{{ s('starts')
              }}<input
                :value="dateValue(draft.startsAt)"
                type="datetime-local"
                @input="setDate('startsAt', $event)" /></label
            ><div class="deadline-field">
              <label class="deadline-toggle">
                <input type="checkbox" :checked="hasDeadline"
                  @change="setDeadline(($event.target as HTMLInputElement).checked)" />
                <span><strong>{{ s(hasDeadline ? 'deadlineEnabled' : 'deadlineDisabled') }}</strong></span>
              </label>
              <label v-if="hasDeadline">{{ s('finishes') }}<input
                  :value="dateValue(draft.finishesAt)"
                  :min="dateValue((draft.startsAt ?? Date.now()) + 60000)"
                  type="datetime-local"
                  @input="setDate('finishesAt', $event)" />
              </label>
            </div>
          </div>
          <p class="field-hint">
            {{ account ? w('taskHint') : s('localShort') }}
          </p>
        </div>
        <div v-show="tab === 'captureSettings'" class="form-section">
          <label
            >{{ s('preset')
            }}<select
              :aria-label="s('preset')"
              :value="draft.presetId"
              @change="pickPreset"
            >
              <option value="">{{ s('standard') }}</option>
              <option
                v-for="preset in presetChoices.filter((item) => !item.archived)"
                :key="preset.id"
                :value="preset.id"
              >
                {{ preset.name }}
              </option>
            </select></label
          ><button type="button" class="secondary-button assignment-create-preset" @click="createPreset">
            <AppIcon name="plus" />{{ s('newPreset') }}
          </button><label
            >{{ s('requiredCount')
            }}<input
              v-model.number="draft.targetCount"
              type="number"
              min="1"
              max="9999"
            /></label
          ><label
            >{{ s('shots')
            }}<textarea
              v-model="shots"
              rows="5"
              maxlength="8100"
              :placeholder="s('onePerLine')"
              @change="syncShots"
            />
          </label>
          <p class="field-hint">{{ s('countHint') }}</p>
        </div>
        <div v-show="tab === 'participants'" class="form-section">
          <div class="form-card selected-team-card">
            <span class="field-hint">{{
              s(draft.teamId ? 'selectedTeam' : 'noTeam')
            }}</span
            ><strong v-if="draft.teamId">{{ selectedTeamName }}</strong>
            <div class="inline-actions">
              <button
                type="button"
                class="secondary-button"
                :aria-label="s('chooseTeam')"
                @click="openTeams()"
              >
                <AppIcon name="users" />{{
                  s(draft.teamId ? 'changeTeam' : 'chooseTeam')
                }}</button
              ><button
                v-if="selectedTeam && selectedTeam.canManage !== false"
                type="button"
                class="quiet-button"
                @click="openTeams(true)"
              >
                <AppIcon name="edit" />{{ s('editTeam') }}
              </button>
            </div>
            <p v-if="draft.teamId" class="field-hint">
              {{ s(selectedTeam ? 'teamSnapshot' : 'teamMissing') }}
            </p>
          </div>
          <ParticipantsEditor v-model="draft.participants" invitations />
          <p class="field-hint">
            {{ account ? w('inviteHint') : s('notifyHint') }}
          </p>
        </div>
        <div v-show="tab === 'rules'" class="form-section">
          <ToggleRow v-model="draft.rules.useAssignmentPhotoId" :label="s('useAssignmentPhotoId')" :hint="s('useAssignmentPhotoIdHint')" />
          <p class="field-hint">{{ s('rulesHint') }}</p>
          <div class="form-card">
            <ToggleRow
              v-model="draft.rules.categoryRequired"
              :label="s('categoryRequired')"
              :hint="s('categoryRequiredHint')"
            /><ToggleRow
              v-model="draft.rules.particularCategory"
              :label="s('particularCategory')"
              :hint="s('categoryLimitHint')"
            /><label v-if="draft.rules.particularCategory" class="inset-field"
              >{{ s('categories')
              }}<textarea
                v-model="categories"
                rows="3"
                maxlength="2430"
                :placeholder="s('onePerLine')"
              />
            </label>
          </div>
          <div class="form-card">
            <ToggleRow
              v-model="draft.rules.descriptionRequired"
              :label="s('descriptionRequired')"
            /><label v-if="draft.rules.descriptionRequired" class="inset-field"
              >{{ s('minLength')
              }}<input
                v-model.number="draft.rules.minLength"
                type="number"
                min="1"
                max="2000"
            /></label>
          </div>
          <div class="form-card">
            <ToggleRow
              v-model="draft.rules.changesAllowed"
              :label="s('changesAllowed')"
            /><ToggleRow
              v-if="draft.rules.changesAllowed"
              v-model="draft.rules.keepOriginal"
              :label="s('keepOriginal')"
            /><ToggleRow
              v-model="draft.rules.deletionAllowed"
              :label="s('deletionAllowed')"
            />
          </div>
          <div class="form-card">
            <ToggleRow
              v-model="draft.rules.galleryAllowed"
              :label="s('galleryAllowed')"
            /><ToggleRow
              v-if="draft.rules.galleryAllowed"
              v-model="draft.rules.thumbnailsOnly"
              :label="s('thumbnailsOnly')"
            />
          </div>
          <div class="form-card">
            <ToggleRow
              v-model="draft.rules.sharingAllowed"
              :label="s('sharingAllowed')"
            /><ToggleRow
              v-if="draft.rules.sharingAllowed"
              v-model="draft.rules.participantsOnly"
              :label="s('participantsOnly')"
            />
          </div>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </form>
      <TeamPicker
        :open="teamPicker"
        :selected-id="draft.teamId"
        :edit-id="editTeamId"
        @clear="clearTeam"
        @close="teamPicker = false"
        @pick="pickTeam"
    /></template>
    <p v-else-if="error" class="form-error screen-body" role="alert">
      {{ error }}
    </p>
  </section>
</template>
