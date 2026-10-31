export const profilePath = (handle: string) => `/people/${encodeURIComponent(handle)}`

/**
 * Intended navigation only: an internal path for an existing private route.
 * Never carry arbitrary query strings, fragments, tokens or external origins.
 */
export function profileReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 ||
      !value.startsWith('/') || value.startsWith('//') || /[\\?#\x00-\x1f]/.test(value))
    return '/profile'
  return /^\/(?:camera(?:\/presets(?:\/[A-Za-z0-9_-]+(?:\/team)?)?)?|gallery(?:\/[A-Za-z0-9_-]+(?:\/(?:edit|card))?)?|assignments(?:\/(?:new|[A-Za-z0-9_-]+(?:\/edit)?))?|messages(?:\/profile\/[A-Za-z0-9_.%\-]+)?|profile\/(?:edit|contacts|photos-security|security|teams(?:\/[A-Za-z0-9_-]+)?)|people\/[A-Za-z0-9_.%\-]+|settings(?:\/data)?|join|profiles(?:\/[A-Za-z0-9_-]+(?:\/team)?)?)$/.test(value)
    ? value : '/profile'
}
