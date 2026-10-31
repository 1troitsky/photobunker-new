/** Device-only presentation preference. No photo IDs, account identifiers or secrets. */
export const homeSections = ['/camera', '/assignments', '/browser', '/photos'] as const
export type HomeSection = typeof homeSections[number]
const STORAGE_KEY = 'pb2.home-section.v1'
const DEFAULT_HOME: HomeSection = '/camera'

export function homeSection(): HomeSection {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (homeSections.some(section => section === saved)) return saved as HomeSection
  } catch { /* Blocked storage must never block app launch. */ }
  return DEFAULT_HOME
}

export function setHomeSection(value: HomeSection): boolean {
  if (!homeSections.some(section => section === value)) return false
  try { localStorage.setItem(STORAGE_KEY, value); return true }
  catch { return false }
}
