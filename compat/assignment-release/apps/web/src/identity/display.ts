export function inAppId(value?: string | null, userId?: string | null): string {
  const visible = userId || value || ''
  return /^[0-9]{8}$/.test(visible) ? visible : '—'
}

// The friendly ID is only presentation. Convert it back at the UI boundary so
// existing server contracts keep using the canonical public ID.
export function publicIdInput(value: string): string {
  const input = value.trim()
  return input.startsWith('@') ? input.toLowerCase() : input
}

export function personLabel(
  person: { publicId: string; userId?: string | null; username?: string | null; fields?: { name?: string; username?: string } },
): string {
  return person.fields?.name || (person.username ? `@${person.username}` :
    person.fields?.username ? `@${person.fields.username}` : inAppId(person.publicId, person.userId))
}
