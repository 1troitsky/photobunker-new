/** One background deadline owns the app PIN and its in-memory photo keys.
 * Full reload still requires PIN. Duplicate hide/pagehide never extend grace.
 */
export function createBackgroundLock(options: {
  enabled: () => boolean; delay: () => number; lock: () => void
}) {
  let started: { wall: number; mono: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  function clear() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined; started = undefined
  }
  function elapsed() {
    if (!started) return 0
    const wall = Date.now() - started.wall
    // Fail closed on a clock rollback; monotonic time also covers sleep on
    // platforms where wall time is adjusted while this document is suspended.
    return wall < -5000 ? Infinity : Math.max(wall, performance.now() - started.mono, 0)
  }
  function expire() {
    if (!options.enabled()) { clear(); return }
    const remaining = options.delay() - elapsed()
    if (remaining <= 0) { clear(); options.lock() }
    else timer = setTimeout(expire, remaining)
  }
  return {
    hide() {
      if (!options.enabled()) { clear(); return }
      started ??= { wall: Date.now(), mono: performance.now() }
      if (timer !== undefined) clearTimeout(timer)
      expire()
    },
    show() {
      if (options.enabled() && started && elapsed() >= options.delay()) {
        clear(); options.lock()
      } else clear()
    },
    clear,
  }
}
