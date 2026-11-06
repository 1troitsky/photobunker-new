import { onScopeDispose, shallowRef, watch, type WatchSource } from 'vue'

// Only initial, blocking page work belongs here. Polling/sync stay in the background.
const jobs = new Set<symbol>()
export const pageLoading = shallowRef(false)
export type PageIssue = { detail: () => string; retry?: () => Promise<unknown> | void }
const issues = new Map<symbol, PageIssue>()
export const pageIssues = shallowRef<PageIssue[]>([])
export function usePageIssue(source: WatchSource<boolean>, issue: PageIssue) {
  const token = Symbol('page-issue')
  const update = (failed: boolean) => {
    if (failed) issues.set(token, issue); else issues.delete(token)
    pageIssues.value = [...issues.values()]
  }
  const stop = watch(source, update, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { stop(); update(false) })
}
export function usePageLoad(source: WatchSource<boolean>) {
  const token = Symbol('page-load')
  const update = (busy: boolean) => {
    if (busy) jobs.add(token); else jobs.delete(token)
    pageLoading.value = jobs.size > 0
  }
  const stop = watch(source, update, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { stop(); update(false) })
}
