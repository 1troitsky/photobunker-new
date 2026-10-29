import * as db from './database'

// Public server time, never a key or a read capability. Keep it through a warm
// lock and persist a monotonic floor for trusted-device offline reloads.
let reference = 0,
  observed = 0
export function observe(serverTime: number) {
  if (!Number.isSafeInteger(serverTime) || serverTime <= 0)
    throw new Error('crypto.clock_uncertain')
  reference = Math.max(reference ? trustedNow() : 0, serverTime)
  observed = performance.now()
}
export function trustedNow() {
  if (!reference) throw new Error('crypto.clock_uncertain')
  return Math.max(Date.now(), reference + performance.now() - observed)
}

type SavedClock = { serverTime: number; savedAt: number }
export async function rememberClock(owner: string, serverTime: number) {
  observe(serverTime)
  await db.put(`clock:${owner}`, {
    // performance.now() contributes fractional milliseconds. Persist the
    // conservative integer ceiling required by restoreClock's strict schema.
    serverTime: Math.ceil(trustedNow()),
    savedAt: Date.now(),
  } satisfies SavedClock)
}
export async function restoreClock(owner: string) {
  const saved = await db.get<SavedClock>(`clock:${owner}`)
  if (!saved || !Number.isSafeInteger(saved.serverTime) || saved.serverTime <= 0 ||
      !Number.isSafeInteger(saved.savedAt) || saved.savedAt <= 0)
    throw new Error('crypto.clock_uncertain')
  const wall = Date.now()
  if (wall < saved.savedAt - 5000) throw new Error('crypto.clock_uncertain')
  const elapsed = Math.max(0, wall - saved.savedAt)
  observe(saved.serverTime + elapsed)
}
