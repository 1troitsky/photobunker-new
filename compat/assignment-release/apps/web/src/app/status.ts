import { readonly, ref, type ComputedRef, type InjectionKey } from 'vue'
import type { Router } from 'vue-router'

export type AppStatus = {
  label: string
  detail: string
  tone: 'progress' | 'warning' | 'error'
} | null

export const appStatusKey: InjectionKey<ComputedRef<AppStatus>> = Symbol('app-status')

export type DiagnosticEvent = {
  id: number
  at: number
  title: string
  detail: string
  durationMs?: number
  tone: 'info' | 'warning' | 'error'
}

const eventRows = ref<DiagnosticEvent[]>([])
let eventId = 0
export const diagnosticEvents = readonly(eventRows)

/** Bounded, non-sensitive device diagnostics. Never pass IDs, URLs or user data. */
export function recordDiagnostic(
  title: string,
  detail: string,
  options: { durationMs?: number; tone?: DiagnosticEvent['tone'] } = {},
) {
  eventRows.value = [{
    id: ++eventId,
    at: Date.now(),
    title,
    detail,
    ...(options.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(options.durationMs)) }),
    tone: options.tone ?? 'info',
  }, ...eventRows.value].slice(0, 80)
}

export function clearDiagnostics() { eventRows.value = [] }

let diagnosticsStarted = false
export function startDiagnostics(router: Router) {
  if (diagnosticsStarted) return
  diagnosticsStarted = true
  const started = new Map<string, number>()
  router.beforeEach(to => {
    started.set(String(to.name || 'screen'), performance.now())
  })
  router.afterEach(to => {
    const name = String(to.name || 'screen')
    const since = started.get(name)
    started.delete(name)
    recordDiagnostic('Navigation', name, {
      durationMs: since === undefined ? undefined : performance.now() - since,
    })
  })
  router.onError(() => recordDiagnostic('Navigation error', 'Screen could not be opened', { tone: 'error' }))
  window.addEventListener('online', () => recordDiagnostic('Connection', 'Online'))
  window.addEventListener('offline', () => recordDiagnostic('Connection', 'Offline', { tone: 'warning' }))
  window.addEventListener('error', () => recordDiagnostic('Application error', 'A client error was captured', { tone: 'error' }))
  window.addEventListener('unhandledrejection', () => recordDiagnostic('Application error', 'An operation was rejected', { tone: 'error' }))
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (navigation)
    recordDiagnostic('Application start', 'Shell loaded', { durationMs: navigation.loadEventEnd || performance.now() })
}
