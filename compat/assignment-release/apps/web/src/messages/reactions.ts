/** Shared presentation contract; Matrix event aggregation lives in PhotoBunker.
 * Explicit finite picker avoids hidden third-party emoji, GIF or telemetry APIs.
 */
export const reactionKeys = ['👍', '❤️', '😂', '😮', '🙌'] as const
export type ReactionKey = (typeof reactionKeys)[number]
export type ReactionSummary = { key: ReactionKey; count: number; mine: boolean }
export type ReactionRecord = { key: string; sender: string; id: string; timestamp: number }
export function isReactionKey(value: string): value is ReactionKey {
  return (reactionKeys as readonly string[]).includes(value)
}
export function summarizeReactions(records: readonly ReactionRecord[], ownUserId: string): ReactionSummary[] {
  const out = new Map<ReactionKey, Map<string, ReactionRecord>>()
  for (const record of records) {
    if (!isReactionKey(record.key) || !record.sender || !record.id) continue
    const group = out.get(record.key) ?? new Map<string, ReactionRecord>()
    const previous = group.get(record.sender)
    if (!previous || previous.timestamp <= record.timestamp) group.set(record.sender, record)
    out.set(record.key, group)
  }
  return reactionKeys.flatMap(key => {
    const group = out.get(key)
    return group?.size ? [{ key, count: group.size, mine: group.has(ownUserId) }] : []
  })
}
