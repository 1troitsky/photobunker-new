<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { assignmentDetails, closeAssignment, respond } from '../collaboration/api'
import { refreshAssignments, selectAssignment } from '../collaboration/store'
import { selectProfile } from '../profiles/store'
import { c } from '../collaboration/text'
import type { Assignment, Submission } from '../collaboration/model'
import { locale } from '../i18n'
import { ServerError } from '../server/api'
import PhotoThumbnail from '../components/PhotoThumbnail.vue'
import ReviewPanel from '../components/ReviewPanel.vue'
const route = useRoute(); const router = useRouter()
const task = ref<Assignment>(); const submissions = ref<Submission[]>([]); const error = ref(false); const busy = ref(false)
const replies = ref<Record<string, { comment: string; note: string; includeNote: boolean; status?: 'responded' | 'failed' | 'conflict' }>>({})
const received = computed(() => new Set(submissions.value.filter(item => ['pending','accepted','correction'].includes(item.state)).map(item => item.shot)))
let timer: ReturnType<typeof setInterval>; let alive = true; let loading = false
async function load() {
  if (loading) return
  loading = true
  try { const result = await assignmentDetails(String(route.params.id)); if (!alive) return; task.value = result.assignment; submissions.value = result.submissions; error.value = false; for (const row of result.submissions) replies.value[row.id] ??= { comment: '', note: '', includeNote: false } }
  catch (failure) { if (alive) { error.value = true; if (failure instanceof ServerError && [403,404,410].includes(failure.status)) { task.value = undefined; submissions.value = [] } } }
  finally { loading = false }
}
function start(replacement?: Submission) { if (!task.value?.canCapture) return; selectProfile(task.value.profileId); selectAssignment(task.value.id, replacement?.id); void router.push({ path:'/camera', query: replacement?.shot ? { shot: replacement.shot } : {} }) }
async function close() { if (!task.value || busy.value || !task.value.closed && !confirm(c('closeConfirm'))) return; busy.value = true; try { await closeAssignment(task.value, !task.value.closed); await refreshAssignments(); await load() } catch { error.value = true } finally { busy.value = false } }
async function reply(item: Submission) { if (busy.value) return; const form = replies.value[item.id]!; busy.value = true; form.status = undefined; try { await respond(item.id, form.comment, form.includeNote ? form.note : undefined, item.revision); form.comment = form.note = ''; form.includeNote = false; form.status = 'responded'; await load() } catch (failure) { form.status = failure instanceof ServerError && failure.status === 409 ? 'conflict' : 'failed' } finally { busy.value = false } }
onMounted(() => { void load(); timer = setInterval(() => { if (!document.hidden && !busy.value) void load() }, 5000) })
onBeforeUnmount(() => { alive = false; clearInterval(timer) })
</script>
<template>
  <section class="content-screen assignment-screen"><RouterLink to="/assignments" class="back-link">← {{ c('backTasks') }}</RouterLink><p v-if="error" class="server-warning" role="alert">{{ c('failed') }}</p>
    <template v-if="task"><header class="page-heading"><p class="eyebrow">{{ task.profile.name }} · {{ c('taskProfile') }} {{ task.profile.version }}</p><h1>{{ task.name }}</h1><p class="task-instructions">{{ task.instructions }}</p></header><p>{{ c('due') }}: {{ task.dueAt ? new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(task.dueAt) : c('noDue') }}</p><p class="field-hint">{{ c('dueHint') }}</p><p v-if="task.dueAt && task.dueAt < Date.now()">{{ c('overdue') }}</p><p v-if="task.closed">{{ c('closed') }}</p><p v-if="task.profile.access?.role === 'contributor' && !task.profile.access.readOwnPhotos" class="supporting-copy">{{ c('dropHint') }}</p><div class="task-actions"><button v-if="task.canCapture" class="primary-button" @click="start()">{{ c('start') }}</button><button class="quiet-button" @click="load">{{ c('refresh') }}</button><button v-if="task.canManage" class="quiet-button" :disabled="busy" @click="close">{{ c(task.closed ? 'reopenTask' : 'closeTask') }}</button></div>
      <section v-if="task.shots.length" class="team-card task-progress"><h2>{{ c('progress') }}: {{ task.shots.filter(shot => received.has(shot)).length }}/{{ task.shots.length }}</h2><ul><li v-for="shot in task.shots" :key="shot">{{ received.has(shot) ? '✓' : '○' }} {{ shot }}</li></ul></section>
      <h2>{{ c('submissions') }}</h2><p v-if="!submissions.length">{{ c('noSubmissions') }}</p><div class="submission-grid"><article v-for="item in submissions" :key="item.id" class="team-card submission-card" :data-photo-id="item.id"><RouterLink v-if="item.canRead" :to="`/gallery/${item.id}`" class="submission-preview"><PhotoThumbnail :id="item.id" :alt="item.shortId" /></RouterLink><h3>{{ item.shortId }}<span v-if="item.shot"> · {{ item.shot }}</span></h3><p class="review-state" :data-state="item.state">{{ c(item.state) }}</p><p v-if="item.comment" class="review-comment">{{ c('comment') }}: {{ item.comment }}</p><p v-if="item.response">{{ c('response') }}: {{ item.response }}</p><p v-if="item.replacesId" class="field-hint">{{ c('replaces') }} {{ submissions.find(row => row.id === item.replacesId)?.shortId ?? item.replacesId }}</p><p v-if="submissions.some(row => row.replacesId === item.id)" class="field-hint">{{ c('replacementSent') }}</p><RouterLink v-if="item.canRead" :to="`/gallery/${item.id}`" class="quiet-button">{{ c('openPhoto') }}</RouterLink><ReviewPanel v-if="task.canManage" :id="item.id" :revision="item.revision" :state="item.state" :comment="item.comment" @changed="load" />
        <form v-if="item.canRespond && replies[item.id]" class="team-form response-form" @submit.prevent="reply(item)"><label>{{ c('response') }}<textarea v-model="replies[item.id]!.comment" required maxlength="2000" rows="2" :disabled="busy" /></label><template v-if="item.state === 'correction'"><label><input v-model="replies[item.id]!.includeNote" type="checkbox" :disabled="busy">{{ c('responseNote') }}</label><textarea v-if="replies[item.id]!.includeNote" v-model="replies[item.id]!.note" :aria-label="c('responseNote')" maxlength="2000" rows="2" :disabled="busy" /></template><button class="secondary-button" :disabled="busy">{{ c('respond') }}</button><p v-if="replies[item.id]!.status" role="status">{{ c(replies[item.id]!.status!) }}</p></form><button v-if="item.canRespond && item.state === 'reshoot' && task.canCapture" class="primary-button" @click="start(item)">{{ c('retake') }}</button>
      </article></div>
    </template>
  </section>
</template>
