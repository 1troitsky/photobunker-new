<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import {
  assignments,
  refreshAssignments,
  selectAssignment,
} from '../collaboration/store'
import { selectProfile } from '../profiles/store'
import {
  clearStudioSession,
  loadStudio,
  localTasks,
  removeItem,
  startTask,
  studioError,
} from '../studio/store'
import { photos } from '../local/library'
import { locale, formatNumber } from '../i18n'
import { account } from '../identity/store'
import WorkspaceInvitations from '../components/WorkspaceInvitations.vue'
import { s } from '../studio/text'
const router = useRouter(),
  query = ref(''),
  search = ref(false),
  filter = ref('all'),
  menu = ref<string>(),
  failed = ref(false)
const rows = computed(() =>
  [
    ...localTasks.value.map((item) => ({
      id: item.id,
      name: item.name,
      instructions: item.instructions,
      closed: item.completed,
      dueAt: item.finishesAt,
      startsAt: item.startsAt,
      count: item.targetCount,
      canCapture:
        !item.accountId ||
        ['owner', 'curator', 'contributor'].includes(item.role || '') && (!item.finishesAt || item.finishesAt > Date.now()),
      local: !item.accountId,
    })),
    ...assignments.value
      .filter(() => !account.value)
      .filter((item) => !localTasks.value.some((local) => local.id === item.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        instructions: item.instructions,
        closed: item.closed,
        dueAt: item.dueAt,
        startsAt: null,
        count: item.shots.length,
        canCapture: item.canCapture,
        local: false,
      })),
  ].filter(
    (item) =>
      (filter.value === 'all' ||
        (filter.value === 'completed') === item.closed) &&
      `${item.name} ${item.instructions}`
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
)
const menuTask = computed(() =>
  localTasks.value.find(
    (item) => item.id === menu.value && item.canManage !== false,
  ),
)
const menuName = computed(
  () => rows.value.find((item) => item.id === menu.value)?.name ?? '',
)
function count(id: string) {
  return photos.value.filter(
    (photo) =>
      (photo.uiAssignmentId === id || photo.assignmentId === id) &&
      !photo.uiVersionOf,
  ).length
}
function start(id: string) {
  const local = localTasks.value.find((item) => item.id === id)
  if (local) startTask(local)
  else {
    const item = assignments.value.find((item) => item.id === id)
    if (!item?.canCapture) return
    clearStudioSession()
    selectProfile(item.profileId)
    selectAssignment(id)
  }
  void router.push('/camera')
}
async function remove() {
  if (!menuTask.value || !confirm(s('deleteItem'))) return
  try {
    await removeItem('tasks', menuTask.value)
    menu.value = undefined
  } catch {
    failed.value = true
  }
}
function navigate(kind: 'edit' | 'duplicate') {
  const id = menu.value
  menu.value = undefined
  void router.push(
    kind === 'edit'
      ? `/assignments/${id}/edit`
      : { path: '/assignments/new', query: { copy: id } },
  )
}
onMounted(() => {
  void loadStudio()
  void refreshAssignments()
})
</script>
<template>
  <section class="native-screen assignments-screen">
    <ScreenHeader :title="s('assignments')"
      ><button
        class="app-icon-button"
        :aria-label="s('newAssignment')"
        @click="router.push('/assignments/new')"
      >
        <AppIcon name="plus" /></button
      ><button
        class="app-icon-button"
        :aria-label="s('search')"
        :aria-pressed="search"
        @click="
          () => {
            search = !search
            query = ''
          }
        "
      >
        <AppIcon name="search" /></button
    ></ScreenHeader>
    <div class="screen-body">
      <WorkspaceInvitations v-if="account" kind="task" /><input
        v-if="search"
        v-model="query"
        class="screen-search"
        type="search"
        :aria-label="s('search')"
        :placeholder="s('search')"
      />
      <div v-if="localTasks.length || assignments.length" class="list-segments">
        <button
          v-for="value in ['all', 'activeTasks', 'completed'] as const"
          :key="value"
          :aria-pressed="filter === value"
          @click="filter = value"
        >
          {{ s(value) }}
        </button>
      </div>
      <p v-if="studioError || failed" class="form-error" role="alert">
        {{ s('failed') }}
      </p>
      <article v-for="item in rows" :key="item.id" class="assignment-tile">
        <div class="assignment-tile-heading">
          <button
            class="assignment-open"
            @click="router.push(`/assignments/${item.id}`)"
          >
            <span class="assignment-symbol"><AppIcon name="profiles" /></span
            ><span
              ><strong>{{ item.name }}</strong
              ><small
                >{{
                  item.closed
                    ? s('completed')
                    : item.startsAt && item.startsAt > Date.now()
                      ? s('scheduled')
                      : s('inProgress')
                }}<template v-if="item.local">
                  · {{ s('device') }}</template
                ></small
              ></span
            ></button
          ><button
            class="app-icon-button"
            :aria-label="`${s('more')}: ${item.name}`"
            @click="menu = item.id"
          >
            <AppIcon name="more" />
          </button>
        </div>
        <p v-if="item.instructions" class="assignment-excerpt">
          {{ item.instructions }}
        </p>
        <div class="assignment-progress">
          <span
            >{{ s('progress') }} {{ count(item.id)
            }}<template v-if="item.count"> / {{ formatNumber(item.count) }}</template></span
          ><span>{{
            item.dueAt
              ? new Intl.DateTimeFormat(locale, {
                  day: 'numeric',
                  month: 'short',
                }).format(item.dueAt)
              : s('noDeadline')
          }}</span>
        </div>
        <div class="progress-track">
          <span
            :style="{
              width: `${Math.min(100, (count(item.id) / Math.max(1, item.count)) * 100)}%`,
            }"
          />
        </div>
        <button
          v-if="
            item.canCapture &&
            !item.closed &&
            (!item.startsAt || item.startsAt <= Date.now())
          "
          class="secondary-button full-button"
          @click="start(item.id)"
        >
          <AppIcon name="camera" />{{ s('capture') }}
        </button>
      </article>
      <div v-if="!rows.length" class="native-empty">
        <AppIcon name="profiles" />
        <h2>
          {{
            localTasks.length || assignments.length
              ? s('noResults')
              : s('noAssignments')
          }}
        </h2>
        <p v-if="!localTasks.length && !assignments.length">
          {{ s('assignmentsEmpty') }}
        </p>
        <button
          v-if="!localTasks.length && !assignments.length"
          class="primary-button"
          @click="router.push('/assignments/new')"
        >
          <AppIcon name="plus" />{{ s('newAssignment') }}
        </button>
      </div>
    </div>
    <AppSheet :open="!!menu" :title="menuName" @close="menu = undefined"
      ><div class="action-list">
        <button v-if="menuTask" @click="navigate('edit')">
          <AppIcon name="edit" />{{ s('edit') }}</button
        ><button @click="navigate('duplicate')">
          <AppIcon name="copy" />{{ s('duplicate') }}</button
        ><button v-if="menuTask" class="subtle-danger" @click="remove">
          <AppIcon name="trash" />{{ s('remove') }}
        </button>
      </div></AppSheet
    >
  </section>
</template>
