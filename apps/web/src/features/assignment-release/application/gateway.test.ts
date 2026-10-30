import {describe,expect,it} from 'vitest'
import {assignmentReleaseGateway,assignmentReleaseUrl,openAssignmentRelease} from './gateway'
describe('PB2 native release routing',()=>{
  it('routes entirely within PB2',()=>{
    expect(assignmentReleaseGateway.status).toBe('native-pb2')
    expect(openAssignmentRelease('camera')).toBe('/camera')
    expect(openAssignmentRelease('photos')).toBe('/photos')
    expect(openAssignmentRelease('profile')).toBe('/profile')
    const photo=crypto.randomUUID()
    expect(openAssignmentRelease('editor',photo)).toBe('/photos/'+photo+'/edit')
    expect(openAssignmentRelease('editor')).toBeNull()
  })
  it('rejects external and unsupported legacy URLs',()=>{
    for(const path of ['https://legacy.example/gallery','//legacy.example/gallery',
      '/_compat/photo-bootstrap','/messages','/gallery','/profile/security',
      '/photos/not-a-uuid','/photos/../welcome'])
      expect(assignmentReleaseUrl(path)).toBeNull()
  })
})
