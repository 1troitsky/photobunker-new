import type { Team, Participant } from './model'
import type { TeamTaskSummary } from '../workspace/team-local'

export type TeamMember = {
  id: string
  name: string
  role: Participant['role'] | 'owner'
  state?: Participant['state']
}
export function teamProfilePath(id: string) {
  // IDs are opaque; never use Team names as identity or generate another Team.
  return '/profile/teams/' + encodeURIComponent(id)
}
export function teamMembers(team?: Team): TeamMember[] {
  if (!team) return []
  const ownerId = team.ownerPublicId
  const members: TeamMember[] = ownerId
    ? [{ id: ownerId, name: ownerId, role: 'owner' }]
    : []
  const used = new Set(members.map(member => member.id.toLowerCase()))
  for (const member of team.participants) {
    const key = member.id.toLowerCase()
    if (used.has(key)) continue
    used.add(key)
    members.push({ id: member.id, name: member.name, role: member.role, state: member.state })
  }
  return members
}
export function visibleTeamTasks(tasks: TeamTaskSummary[], id: string) {
  // Workspace already limits records to this viewer; never look up other
  // owners' assignments by team name, and never infer access from membership.
  return tasks.filter(task => task.teamId === id)
}
