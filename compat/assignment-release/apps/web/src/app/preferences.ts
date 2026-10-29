import { ref } from 'vue'

export const dockPaths = ['/assignments', '/messages', '/camera', '/gallery', '/profile'] as const
type DockPath = typeof dockPaths[number]
export type Startup = DockPath | 'last'
export type Theme = 'dark' | 'light' | 'system'
const key = 'photobunker.app-preferences.v1'
export const theme = ref<Theme>('dark')
export const startup = ref<Startup>('/camera')
const last = ref<DockPath>('/camera')
export const preferencesSaved = ref(true)

function read() {
  theme.value = 'dark'; startup.value = '/camera'; last.value = '/camera'
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (['dark', 'light', 'system'].includes(saved.theme)) theme.value = saved.theme
    if ([...dockPaths, 'last'].includes(saved.startup)) startup.value = saved.startup
    if (dockPaths.includes(saved.last)) last.value = saved.last
  } catch { /* A damaged or unavailable preference must never prevent launch. */ }
}
read()

function persist() {
  try { localStorage.setItem(key, JSON.stringify({ theme: theme.value, startup: startup.value, last: last.value })); preferencesSaved.value = true }
  catch { preferencesSaved.value = false }
}
function applyTheme() {
  const value = theme.value === 'system' ? globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark' : theme.value
  document.documentElement.dataset.theme = value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'light' ? '#f4f5f7' : '#111216')
}
export function initializePreferences() {
  read(); applyTheme()
  const media = globalThis.matchMedia?.('(prefers-color-scheme: light)')
  media?.addEventListener('change', applyTheme)
  return () => media?.removeEventListener('change', applyTheme)
}
export function setTheme(value: Theme) { theme.value = value; applyTheme(); persist() }
export function setStartup(value: Startup) { startup.value = value; persist() }
export function launchPath(): DockPath { return startup.value === 'last' ? last.value : startup.value }
export function rememberSection(path: string) {
  // Store only a section, never a photo/task ID or a secret from a URL.
  const section = dockPaths.find(item => path === item || path.startsWith(`${item}/`))
  if (section && section !== last.value) { last.value = section; persist() }
}
