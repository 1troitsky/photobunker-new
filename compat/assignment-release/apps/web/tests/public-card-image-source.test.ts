// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  read: vi.fn(), versions: vi.fn(), save: vi.fn(),
  photo: { id:'photo',accountId:'owner',workspaceAccess:{read:true,edit:true,shareExternal:true} },
}))
vi.mock('../src/identity/store', () => ({ account:{value:{id:'owner'}} }))
vi.mock('../src/crypto/store', () => ({ photoReadAllowed:()=>true }))
vi.mock('../src/studio/photo-card-reader', () => ({ readPrivateCardPhoto:async()=>fixture.photo }))
vi.mock('../src/studio/versions', () => ({listPhotoVersions:fixture.versions,savePhotoVersion:fixture.save,emptyEdits:()=>({})}))
vi.mock('../src/server/photos', () => ({ readPhoto:fixture.read }))
vi.mock('../src/studio/export', () => ({ externalPhotoFile:vi.fn() }))
import { prepareCardPhotoVersion } from '../src/studio/card-share-images'

describe('Public card image source', () => {
  it('uses the latest committed edited version without reading original pixels', async () => {
    const latest={id:'redacted',createdAt:20,sync:'synced',conflict:false}
    fixture.versions.mockResolvedValue([{id:'older',createdAt:10,sync:'synced'},latest])
    expect(await prepareCardPhotoVersion('photo')).toBe(latest)
    expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.save).not.toHaveBeenCalled()
  })
  it('fails closed for a pending redacted version instead of publishing an older edit or original', async () => {
    fixture.versions.mockResolvedValue([{id:'older',createdAt:10,sync:'synced'},{id:'redacted',createdAt:20,sync:'pending'}])
    await expect(prepareCardPhotoVersion('photo')).rejects.toThrow('version.unavailable')
    expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.save).not.toHaveBeenCalled()
  })
})
