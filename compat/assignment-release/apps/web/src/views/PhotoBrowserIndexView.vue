<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import { account, deviceId, hasConfirmedIdentity } from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { protectionReady, protectionEnabled, photoReadAllowed } from '../crypto/store'
import { localTasks, loadStudio } from '../studio/store'
import { saveBrowser } from '../photo-browser/cache'
import { bt } from '../photo-browser/text'

const router = useRouter(), route = useRoute()
const selected = ref<string[]>([])
const working = ref(false)
const failed = ref(false)
const available = computed(() => localTasks.value.filter(task =>
  task.accountId === account.value?.id &&
  (task.canManage || task.role === 'owner' || task.role === 'curator'),
))
const ready = computed(() =>
  appLockReady.value && !appLocked.value && hasConfirmedIdentity() &&
  protectionReady.value && (!protectionEnabled.value || photoReadAllowed()) &&
  !!deviceId.value,
)
watch([() => account.value?.id, deviceId, appLocked], () => {
  selected.value = []
  failed.value = false
}, { flush: 'sync' })
let prefilled = false
watch(available, tasks => {
  if (prefilled) return
  const id = typeof route.query.assignment === 'string' ? route.query.assignment : ''
  if (!id || !tasks.some(task => task.id === id)) return
  selected.value = [id]
  prefilled = true
}, { immediate: true })
function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter(x => x !== id) : [...selected.value, id]
}
async function create() {
  if (!ready.value || working.value || !selected.value.length || selected.value.length > 20) return
  const owner = account.value!.id, device = deviceId.value
  const tasks = available.value.filter(task => selected.value.includes(task.id))
  if (tasks.length !== selected.value.length) return
  working.value = true
  failed.value = false
  const id = crypto.randomUUID()
  try {
    // Durable account/device-scoped encrypted intent before the first network request.
    await saveBrowser(owner, device, {
      collection: { id, assignments: tasks.map(task => ({ id: task.id, name: task.name })),
        expiresAt: Date.now() + 7 * 86400000, canRevoke: true },
      photos: [],
      pending: { assignmentIds: tasks.map(task => task.id) },
    })
    if (account.value?.id !== owner || deviceId.value !== device || !ready.value) return
    await router.push('/browser/' + id)
  } catch {
    if (account.value?.id === owner) failed.value = true
  } finally {
    working.value = false
  }
}
watch(ready, enabled => {
  if (enabled) void loadStudio().catch(() => { failed.value = true })
}, { immediate: true })
</script>

<template>
  <section class="native-screen protected-browser">
    <ScreenHeader :title="bt('newCollection')" back="/assignments" />
    <div class="screen-body browser-body">
      <p class="field-hint">{{ bt('sharedWith') }}</p>
      <p v-if="failed" role="alert" class="form-error">{{ bt('loadFailed') }}</p>
      <div v-if="!ready" role="status" class="native-empty"><AppIcon name="lock" />
        <p>{{ bt('locked') }}</p></div>
      <div v-else-if="!available.length" role="status" class="native-empty"><AppIcon name="folder" />
        <p>{{ bt('noAssignments') }}</p></div>
      <template v-else>
        <h2>{{ bt('chooseAssignments') }}</h2>
        <div class="browser-assignment-choices">
          <label v-for="task in available" :key="task.id" class="browser-assignment-choice">
            <input type="checkbox" :checked="selected.includes(task.id)" :disabled="working"
              @change="toggle(task.id)" />
            <span>{{ task.name }}</span>
          </label>
        </div>
        <p class="field-hint">{{ bt('selected') }}: {{ selected.length }} / 20 · {{ bt('days') }}</p>
        <button type="button" class="primary-button" :disabled="working || !selected.length || selected.length > 20"
          @click="create"><AppIcon name="folder" />{{ bt('openCollection') }}</button>
      </template>
    </div>
  </section>
</template>
