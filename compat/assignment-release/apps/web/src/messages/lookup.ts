import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { identityRequest, IdentityError } from '../identity/api'
import type { Person } from '../identity/store'
import type { Peer } from './store'

export type FoundPerson = Peer & Person

// Only exact identifiers go to the server. Names filter the user's own contacts.
export function personHandle(value: string) {
  const text = value.trim()
  if (/^pb_[a-z0-9]+$/i.test(text) || /^@[a-z0-9_.-]+(?::[a-z0-9.:-]+)?$/i.test(text)) return text
  if (/^[a-z0-9_.-]{3,32}$/i.test(text)) return '@' + text
  return ''
}

export function usePersonLookup(query: Ref<string>, enabled: Ref<boolean>, owner: Ref<string>) {
  const person = shallowRef<FoundPerson>(), busy = ref(false)
  const error = ref<'missing' | 'failed' | ''>('')
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined
  function clear() {
    generation++
    clearTimeout(timer)
    person.value = undefined
    busy.value = false
    error.value = ''
  }
  async function find() {
    clear()
    const handle = personHandle(query.value), version = generation, identity = owner.value
    if (!handle || !enabled.value || !identity) return
    busy.value = true
    try {
      const found = await identityRequest<FoundPerson>(`/matrix/resolve/${encodeURIComponent(handle)}`)
      if (version === generation && owner.value === identity && enabled.value) person.value = found
    } catch (failure) {
      if (version === generation && owner.value === identity && enabled.value)
        error.value = failure instanceof IdentityError && failure.status === 404 ? 'missing' : 'failed'
    } finally {
      if (version === generation) busy.value = false
    }
  }
  watch([query, enabled, owner], () => {
    clear()
    if (enabled.value && owner.value && personHandle(query.value)) {
      busy.value = true
      timer = setTimeout(() => void find(), 300)
    }
  }, { flush: 'sync' })
  onScopeDispose(clear)
  return { person, busy, error, find }
}
