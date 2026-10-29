// Server anchors bound cloud lifetime. An upload never substitutes a fresh anchor.
const PREFIX = 'photobunker-clock-'
export type Anchor = { id: string; issuedAt: number; receivedAt: number; lastWall: number }
const anchors = new Map<string, Anchor>()
const runtime = new Map<string, { start: number; server: number }>()
const uncertain = new Set<string>()
function load(library: string): Anchor | undefined {
  if (!anchors.has(library)) {
    try { const value = JSON.parse(localStorage.getItem(PREFIX + library) ?? 'null'); if (value?.id && Number.isFinite(value.issuedAt)) anchors.set(library, value) } catch { /* No offline anchor available. */ }
  }
  return anchors.get(library)
}
function persist(library: string, anchor: Anchor) { try { localStorage.setItem(PREFIX + library, JSON.stringify(anchor)) } catch { /* Current session remains usable. */ } }
export function rememberAnchor(library: string, value: { id: string; issuedAt: number }) {
  const anchor = { ...value, receivedAt: Date.now(), lastWall: Date.now() }
  anchors.set(library, anchor); uncertain.delete(library)
  runtime.set(library, { start: performance.now(), server: value.issuedAt })
  persist(library, anchor)
}
export function clockTime(library: string): { now: number; certain: boolean } {
  const wall = Date.now(); const anchor = load(library)
  if (!anchor) return { now: wall, certain: false }
  if (wall < anchor.lastWall - 5000) uncertain.add(library)
  anchor.lastWall = Math.max(anchor.lastWall, wall)
  const live = runtime.get(library)
  const now = Math.max(anchor.issuedAt + Math.max(0, anchor.lastWall - anchor.receivedAt), live ? live.server + performance.now() - live.start : 0)
  persist(library, anchor)
  return { now, certain: !uncertain.has(library) }
}
export function captureRetention(library: string, createdAt: number, seconds: number) {
  const anchor = load(library)
  return { retentionSeconds: seconds, retentionAnchor: anchor?.id,
    expiresAt: Math.min(createdAt + seconds * 1000, anchor ? anchor.issuedAt + seconds * 1000 : Infinity) }
}
export function isExpired(photo: { expiresAt?: number; remoteLibraryId?: string }, now = clockTime(photo.remoteLibraryId ?? '').now) {
  return photo.expiresAt !== undefined && photo.expiresAt <= now
}
