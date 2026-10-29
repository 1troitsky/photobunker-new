import { computed, ref, watch } from 'vue'
import { accessCode, accessLibraryId } from '../server/api'
import { listAssignments, listSubmissions } from './api'
import type { Assignment, Submission } from './model'
export const assignments = ref<Assignment[]>([])
export const ownSubmissions = ref<Submission[]>([])
export const tasksError = ref(false)
export const taskId = ref('')
export const replacesId = ref('')
export const activeAssignment = computed(() => assignments.value.find(task => task.id === taskId.value && task.canCapture && !task.closed))
const key = () => `photobunker-assignments-${accessLibraryId.value || 'none'}`
let generation = 0
function cache() { try { localStorage.setItem(key(), JSON.stringify({ assignments: assignments.value, taskId: taskId.value, replacesId: replacesId.value })) } catch {} }
function load() { assignments.value = []; ownSubmissions.value = []; taskId.value = replacesId.value = ''; try { const saved = JSON.parse(localStorage.getItem(key()) ?? '{}'); if (Array.isArray(saved.assignments)) assignments.value = saved.assignments; taskId.value = saved.taskId ?? ''; replacesId.value = saved.replacesId ?? '' } catch {} }
load()
export function selectAssignment(id: string, replacement = '') { taskId.value = id; replacesId.value = replacement; cache() }
export async function refreshAssignments() {
  const current = ++generation
  try { const [result, submissions] = accessCode.value ? await Promise.all([listAssignments(), listSubmissions()]) : [[], []]; if (current !== generation) return; assignments.value = result; ownSubmissions.value = submissions; tasksError.value = false; cache() }
  catch { if (current === generation) tasksError.value = true }
}
watch(accessLibraryId, () => { load(); void refreshAssignments() })
export function startCollaboration() {
  const refresh = () => { void refreshAssignments() }
  const timer = setInterval(refresh, 10_000)
  window.addEventListener('focus', refresh); window.addEventListener('online', refresh); refresh()
  return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
}
