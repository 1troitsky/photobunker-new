<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { guardReload } from '../studio/unsaved'
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
  error = ref(''),
  teamPicker = ref(false),
  editTeamId = ref('')
const shots = ref(''),
  categories = ref('')
let initial = '',
  saved = false
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
const signature = () =>
  `${JSON.stringify(draft.value)}|${shots.value}|${categories.value}`
const dirty = computed(() => ready.value && signature() !== initial)
guardReload(dirty, busy)
watch(signature, () => {
  error.value = ''
})
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
  shots.value = item.shots.join('\n')
  categories.value = item.rules.categories.join('\n')
  initial = signature()
  ready.value = true
})
function pickPreset(event: Event) {
  draft.value.presetId = (event.target as HTMLSelectElement).value
  draft.value.preset = asLocalPreset(draft.value.presetId) ?? null
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
async function save() {
  if (!ready.value || busy.value) return
  draft.value.shots = lines(shots.value)
  draft.value.rules.categories = draft.value.rules.particularCategory
    ? lines(categories.value)
    : []
  const invalid = validateTask(draft.value)
  if (invalid) {
    tab.value = invalid
    error.value = s(
      invalid === 'basics' &&
        draft.value.startsAt !== null &&
        draft.value.finishesAt !== null &&
        draft.value.finishesAt <= draft.value.startsAt
        ? 'datesInvalid'
        : 'required',
    )
    return
  }
  const actor = account.value?.id
  busy.value = true
  error.value = ''
  try {
    const item = await saveTask(draft.value)
    if (actor !== account.value?.id) return
    saved = true
    await router.replace(`/assignments/${item.id}`)
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
  (id, previous) => {
    if (previous && id !== previous) {
      saved = true
      ready.value = false
      draft.value = newTask('')
      void router.replace('/assignments')
    }
  },
)
onBeforeRouteLeave(
  () => saved || (!busy.value && (!dirty.value || confirm(s('leave')))),
)
</script>
<template>
  <section class="native-screen native-editor assignment-editor">
    <ScreenHeader
      :title="s(fresh ? 'newAssignment' : 'editAssignment')"
      :back="fresh ? '/assignments' : `/assignments/${route.params.id}`"
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
            ><label
              >{{ s('finishes')
              }}<input
                :value="dateValue(draft.finishesAt)"
                type="datetime-local"
                @input="setDate('finishesAt', $event)"
            /></label>
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
          ><label
            >{{ s('requiredCount')
            }}<input
              v-model.number="draft.targetCount"
              type="number"
              min="1"
              max="999" /></label
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
        <footer class="editor-footer">
          <button
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="router.push('/assignments')"
          >
            {{ s('cancel') }}</button
          ><button type="submit" class="primary-button" :disabled="busy">
            {{ s(busy ? 'saving' : 'save') }}
          </button>
        </footer>
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
