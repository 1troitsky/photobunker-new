import { describe, expect, it } from 'vitest'
import { teamMembers, teamProfilePath, visibleTeamTasks } from '../src/studio/team-profile'
import { profileReturnTo } from '../src/identity/person'
import type { Team } from '../src/studio/model'

const team: Team = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Synthetic team',
  description: 'Private description',
  ownerPublicId: 'pb_owner',
  participants: [
    { id: 'pb_guest', name: 'Guest', role: 'viewer', notify: true, state: 'accepted' },
    { id: 'pb_PENDING', name: 'Pending', role: 'contributor', notify: true, state: 'invited' },
    { id: 'PB_guest', name: 'Duplicate', role: 'curator', notify: true },
  ],
  revision: 4, role: 'owner', canManage: true,
}
describe('R1-04 / stable Team identity without merging legacy Space', () => {
  it('uses opaque team ID and preserves private returnTo after authentication', () => {
    const path = teamProfilePath(team.id)
    expect(path).toBe('/profile/teams/11111111-2222-4333-8444-555555555555')
    expect(profileReturnTo(path)).toBe(path)
    expect(profileReturnTo('/profile/teams/../../outside')).toBe('/profile')
    expect(profileReturnTo('https://attacker.example')).toBe('/profile')
    expect(profileReturnTo('/camera/presets/old-preset/team')).toBe('/camera/presets/old-preset/team')
  })
  it('shows one creator and one row per participant ID, never joins teams by name', () => {
    const members = teamMembers(team)
    expect(members.map(row => row.id)).toEqual(['pb_owner', 'pb_guest', 'pb_PENDING'])
    expect(members.map(row => row.role)).toEqual(['owner', 'viewer', 'contributor'])
    expect(members[2]).toMatchObject({ state: 'invited' })
    expect(teamMembers({ ...team, ownerPublicId: undefined })[0]?.role).toBe('viewer')
  })
  it('lists only existing accessible tasks with the exact team ID', () => {
    const tasks = [
      { id: 'work-a', teamId: team.id, name: 'Inside', completed: false },
      { id: 'work-b', teamId: 'different', name: 'Same name', completed: false },
      { id: 'work-c', teamId: team.id, name: 'Also inside', completed: true },
    ]
    expect(visibleTeamTasks(tasks, team.id).map(task => task.id)).toEqual(['work-a', 'work-c'])
  })
})
