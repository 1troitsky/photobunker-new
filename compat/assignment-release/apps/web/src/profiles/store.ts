import { activeAssignment, selectAssignment } from '../collaboration/store'
import { computed, ref, watch } from 'vue'
import { accessCode, accessLibraryId, ensureAccess, prototypeRequest } from '../server/api'
import type { Profile } from './model'

export const profiles = ref<Profile[]>([])
export const profilesLoading = ref(false)
export const profilesError = ref(false)
const activeId = ref('')
export const activeProfile = computed(() => activeAssignment.value?.profile ?? profiles.value.find(profile => profile.id === activeId.value && !profile.archived))
let generation = 0
const cacheKey = () => `photobunker-profiles-${accessLibraryId.value || 'none'}`
function readCache() {
  profiles.value = []; activeId.value = ''
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey()) ?? '{}')
    if (Array.isArray(saved.profiles)) profiles.value = saved.profiles
    activeId.value = saved.activeId ?? ''
  } catch { /* Profiles can still be read from the server. */ }
}
function cache() { try { localStorage.setItem(cacheKey(), JSON.stringify({ profiles: profiles.value, activeId: activeId.value })) } catch { /* Server is the durable source. */ } }
readCache()
export function selectProfile(id: string) { selectAssignment(''); activeId.value = id; cache() }
export async function refreshProfiles() {
  const current = ++generation
  profilesLoading.value = true; profilesError.value = false
  try {
    const result = accessCode.value ? await (await prototypeRequest('/profiles')).json() : { profiles: [] }
    if (current !== generation) return
    profiles.value = result.profiles
    cache()
  } catch { if (current === generation) profilesError.value = true }
  finally { if (current === generation) profilesLoading.value = false }
}
export async function saveProfile(profile: Profile): Promise<Profile> {
  await ensureAccess()
  const result = (await (await prototypeRequest(`/profiles/${profile.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...profile, archived: profile.archived ?? false }) })).json()).profile as Profile
  profiles.value = [...profiles.value.filter(item => item.id !== result.id), result]
  if (!activeId.value && !result.archived) activeId.value = result.id
  cache()
  return result
}
watch(accessLibraryId, () => { readCache(); void refreshProfiles() })
