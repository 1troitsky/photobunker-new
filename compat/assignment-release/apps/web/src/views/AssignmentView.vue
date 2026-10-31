<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LegacyAssignmentView from './LegacyAssignmentView.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import FormTabs from '../components/FormTabs.vue'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import {
  loadStudio,
  localTasks,
  removeItem,
  saveTask,
  startTask,
  studioReady,
} from '../studio/store'
import { photos, refreshLibrary } from '../local/library'
import { locale } from '../i18n'
import { q } from '../crypto/text'
import WorkspaceReceipts from '../components/WorkspaceReceipts.vue'
import { respond } from '../workspace/api'
import { receipts } from '../workspace/state'
import { account } from '../identity/store'
import { w } from '../workspace/text'
import { s } from '../studio/text'
const route = useRoute(),
  router = useRouter(),
  tab = ref('materials'),
  menu = ref(false),
  failed = ref(false),
  busy = ref(false)
const task = computed(() =>
  localTasks.value.find((item) => item.id === route.params.id),
)
const materials = computed(() =>
  photos.value.filter(
    (photo) => photo.uiAssignmentId === task.value?.id && !photo.uiVersionOf,
  ),
)
const shots = computed(
  () => new Set(materials.value.map((photo) => photo.shot)),
)
const tabs = computed(() =>
  (['materials', 'requirements', 'participants'] as const).map((id) => ({
    id,
    label: s(id),
  })),
)
const canStart = computed(
  () =>
    !!task.value &&
    !task.value.completed &&
    (!task.value.accountId ||
      ['owner', 'curator', 'contributor'].includes(task.value.role || '')) &&
    (!task.value.finishesAt || task.value.finishesAt > Date.now()) &&
    (!task.value.startsAt || task.value.startsAt <= Date.now()),
)
async function leave() {
  const member = task.value?.participants.find(
    (person) => person.id === account.value?.publicId,
  )
  if (!member?.invitationId || !confirm(w('leave') + '?')) return
  try {
    await respond(member.invitationId, false)
    await loadStudio()
    await router.replace('/assignments')
  } catch {
    failed.value = true
  }
}
function start() {
  if (task.value && canStart.value) {
    startTask(task.value)
    void router.push('/camera')
  }
}
async function complete() {
  if (!task.value || busy.value) return
  busy.value = true
  try {
    await saveTask({ ...task.value, completed: !task.value.completed })
    menu.value = false
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!task.value || !confirm(s('deleteItem'))) return
  try {
    await removeItem('tasks', task.value)
    menu.value = false
    await router.replace('/assignments')
  } catch {
    failed.value = true
  }
}
onMounted(() => {
  void loadStudio()
  void refreshLibrary()
})
</script>
<template>
  <section v-if="task" class="native-screen assignment-screen">
    <ScreenHeader
      :title="task.name"
      back="/assignments"
      :subtitle="task.accountId ? w('account') : s('device')"
      ><button
        v-if="task.canManage !== false"
        class="app-icon-button"
        :aria-label="s('more')"
        @click="menu = true"
      >
        <AppIcon name="more" /></button
    ></ScreenHeader>
    <div class="assignment-overview">
      <div>
        <strong
          >{{
            new Set([
              ...materials.filter(photo => typeof photo.remoteRevision === 'number').map((photo) => photo.id),
              ...receipts
                .filter((item) => item.assignmentId === task?.id)
                .map((item) => item.id),
            ]).size
          }}<small> / {{ task.targetCount }}</small></strong
        ><span>{{ s('progress') }}</span>
      </div>
      <div>
        <span class="state-pill">{{
          task.completed
            ? s('completed')
            : task.startsAt && task.startsAt > Date.now()
              ? s('scheduled')
              : s('inProgress')
        }}</span
        ><small>{{
          task.finishesAt
            ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                task.finishesAt,
              )
            : s('noDeadline')
        }}</small>
      </div>
    </div>
    <div v-if="task.accountId" class="screen-body">
      <button
        class="secondary-button full-button"
        @click="
          () => {
            if (!task) return
            router.push({ path: '/messages', query: { assignment: task.id } })
          }
        "
      >
        <AppIcon name="messages" />{{ w('discussion') }}
      </button>
      <p v-if="task.discussion?.state === 'pending'" class="field-hint">
        {{ w('discussionPending') }}
      </p>
    </div>
    <div v-if="task.accountId" class="screen-body">
      <RouterLink :to="{ path: '/browser', query: { assignment: task.id } }"
        class="secondary-button full-button">
        <AppIcon name="folder" />{{ s('photoBrowser') }}</RouterLink>
    </div>
    <FormTabs v-model="tab" :items="tabs" />
    <div class="screen-body"><button v-if="account" class="secondary-button" @click="router.push({path:'/profile/photos-security',query:{assignment:String(route.params.id)}})">{{ q('Защита задания') }}</button>
      <p v-if="failed" class="form-error" role="alert">{{ s('failed') }}</p>
      <template v-if="tab === 'materials'"
        ><WorkspaceReceipts v-if="task.accountId" :assignment-id="task.id" />
        <div v-if="materials.length" class="native-photo-grid">
          <button
            v-for="photo in materials"
            :key="photo.id"
            class="native-photo-tile"
            :aria-label="`${s('preview')}: ${photo.shortId}`"
            @click="router.push(`/gallery/${photo.id}`)"
          >
            <PhotoThumbnail
              :id="photo.id"
              :access-key="
                photo.accountId
                  ? `${photo.remoteRevision}:${photo.thumbnailOnly}`
                  : undefined
              "
              :alt="photo.title || photo.shortId"
            /><span>{{ photo.shot || photo.category || photo.shortId }}</span>
          </button>
        </div>
        <div v-else class="native-empty">
          <AppIcon name="gallery" />
          <h2>{{ s('noMaterials') }}</h2>
          <button v-if="canStart" class="primary-button" @click="start">
            <AppIcon name="camera" />{{ s('capture') }}
          </button>
        </div></template
      >
      <template v-else-if="tab === 'requirements'"
        ><p v-if="task.instructions" class="task-instructions">
          {{ task.instructions }}
        </p>
        <dl class="native-facts">
          <div>
            <dt>{{ s('preset') }}</dt>
            <dd>{{ task.preset?.name ?? s('standard') }}</dd>
          </div>
          <div v-if="task.teamId">
            <dt>{{ s('team') }}</dt>
            <dd><RouterLink :to="'/profile/teams/' + encodeURIComponent(task.teamId)">{{ task.teamName || s('team') }}</RouterLink></dd>
          </div>
          <div>
            <dt>{{ s('requiredCount') }}</dt>
            <dd>{{ task.targetCount }}</dd>
          </div>
          <div v-if="task.startsAt">
            <dt>{{ s('starts') }}</dt>
            <dd>
              {{
                new Intl.DateTimeFormat(locale, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(task.startsAt)
              }}
            </dd>
          </div>
          <div>
            <dt>{{ s('finishes') }}</dt>
            <dd>
              {{
                task.finishesAt
                  ? new Intl.DateTimeFormat(locale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(task.finishesAt)
                  : s('noDeadline')
              }}
            </dd>
          </div>
        </dl>
        <div v-if="task.shots.length" class="checklist">
          <h2>{{ s('shots') }}</h2>
          <p v-for="shot in task.shots" :key="shot">
            <AppIcon :name="shots.has(shot) ? 'check' : 'camera'" />{{ shot }}
          </p>
        </div>
        <div class="requirement-chips">
          <span v-if="task.rules.categoryRequired">{{
            s('categoryRequired')
          }}</span
          ><span v-if="task.rules.descriptionRequired"
            >{{ s('descriptionRequired') }} · {{ task.rules.minLength }}</span
          ><span v-if="!task.rules.galleryAllowed"
            >{{ s('galleryAllowed') }}: {{ s('locationOff') }}</span
          >
        </div>
        <p class="field-hint">
          {{ task.accountId ? w('taskHint') : s('localHint') }}
        </p></template
      >
      <div v-else class="participant-list">
        <div class="participant-row owner-row">
          <span class="person-avatar"><AppIcon name="user" /></span
          ><span
            ><strong>{{
              task.ownerPublicId && task.ownerPublicId !== account?.publicId
                ? task.ownerPublicId
                : s('you')
            }}</strong
            ><small>{{ s('owner') }}</small></span
          >
        </div>
        <div
          v-for="participant in task.participants"
          :key="participant.id"
          class="participant-row"
        >
          <span class="person-avatar">{{
            (participant.name || participant.id).slice(0, 1).toUpperCase()
          }}</span
          ><span
            ><strong>{{ participant.name || participant.id }}</strong
            ><small
              >{{ s(participant.role) }} · {{ participant.id
              }}<template v-if="task.accountId && participant.state">
                · {{ w(participant.state) }}</template
              ></small
            ></span
          >
        </div>
        <p class="field-hint">
          {{ task.accountId ? w('inviteHint') : s('notifyHint') }}
        </p>
        <button
          v-if="task.accountId && !task.canManage"
          class="quiet-button subtle-danger"
          @click="leave"
        >
          {{ w('leave') }}
        </button>
      </div>
    </div>
    <footer v-if="canStart && materials.length" class="task-capture-footer">
      <button class="primary-button full-button" @click="start">
        <AppIcon name="camera" />{{ s('capture') }}
      </button>
    </footer>
    <AppSheet :open="menu" :title="task.name" :busy="busy" @close="menu = false"
      ><div class="action-list">
        <button
          @click="
            () => {
              menu = false
              if (!task) return
              router.push(`/assignments/${task.id}/edit`)
            }
          "
        >
          <AppIcon name="edit" />{{ s('edit') }}</button
        ><button
          @click="
            () => {
              menu = false
              if (!task) return
              router.push({
                path: '/assignments/new',
                query: { copy: task.id },
              })
            }
          "
        >
          <AppIcon name="copy" />{{ s('duplicate') }}</button
        ><button @click="complete">
          <AppIcon name="check" />{{
            s(task.completed ? 'reopen' : 'finish')
          }}</button
        ><button class="subtle-danger" @click="remove">
          <AppIcon name="trash" />{{ s('remove') }}
        </button>
      </div></AppSheet
    >
  </section>
  <div v-else-if="studioReady && account" class="native-empty">
    <AppIcon name="lock" />
    <p>{{ w('accessChanged') }}</p>
  </div>
  <LegacyAssignmentView v-else-if="studioReady" />
</template>
