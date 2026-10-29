import { onBeforeUnmount, type Ref } from 'vue'

export function guardReload(dirty: Readonly<Ref<boolean>>, busy: Readonly<Ref<boolean>>) {
  const guard = (event: BeforeUnloadEvent) => {
    if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' }
  }
  window.addEventListener('beforeunload', guard)
  onBeforeUnmount(() => window.removeEventListener('beforeunload', guard))
}
