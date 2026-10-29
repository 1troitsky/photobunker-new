import { beforeEach, expect, it, vi } from 'vitest'
import { account } from '../src/identity/store'
import { pendingAccess, pendingGrant, taskGrants } from '../src/workspace/access'
import { newTask } from '../src/studio/model'
vi.mock('../src/identity/store', async () => ({ account: (await import('vue')).ref() }))
const photo = { accountId: 'owner', workspaceAssignmentId: 'task' }
beforeEach(() => {
  account.value = { id: 'owner', publicId: 'public-owner' } as typeof account.value
  taskGrants.value = [{ ...newTask('Task'), id: 'task', role: 'contributor', participants: [{ id: 'public-owner', name: '', role: 'contributor', notify: false }] }]
})
it('limits queued photographs to the same account and accepted task context', () => {
  expect(pendingAccess({ ...photo, accountId: 'another' })).toBe(false)
  expect(pendingAccess({ ...photo, workspaceAssignmentId: 'another' })).toBe(false)
  expect(pendingAccess({ ...photo, uploadOnly: true })).toBe(false)
})
it.each(['curator', 'contributor', 'viewer'] as const)('honors no-view scope for a queued %s capture', role => {
  taskGrants.value[0]!.role = role
  taskGrants.value[0]!.participants[0]!.photoScope = 'none'
  expect(pendingAccess(photo)).toBe(false)
  expect(pendingGrant(photo)).toMatchObject({ read: false, thumbnail: false, edit: false, share: false, shareExternal: false })
})
it('grants only a thumbnail before upload when the task limits viewing', () => {
  taskGrants.value[0]!.participants[0]!.photoScope = 'thumbnails'
  expect(pendingGrant(photo)).toMatchObject({ read: false, thumbnail: true, edit: false, shareExternal: false })
})
it('distinguishes internal references from external file export', () => {
  expect(pendingGrant(photo)).toMatchObject({ read: true, share: true, shareExternal: false })
  taskGrants.value[0]!.rules.participantsOnly = false
  expect(pendingGrant(photo).shareExternal).toBe(true)
  expect(pendingGrant({ accountId: 'owner' })).toMatchObject({ role: 'owner', read: true, shareExternal: true })
})
