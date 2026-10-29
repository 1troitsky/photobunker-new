let depth = 0, original = ''
export function lockScroll() {
  if (depth++ === 0) { original = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  let active = true
  return () => { if (!active) return; active = false; if (--depth === 0) document.body.style.overflow = original }
}
