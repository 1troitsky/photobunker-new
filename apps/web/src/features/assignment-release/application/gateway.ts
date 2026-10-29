import type {AssignmentReleaseGateway, ReleaseScreen} from '../domain/contracts'

function configuredOrigin():URL|null {
  const raw = import.meta.env.VITE_ASSIGNMENT_RELEASE_ORIGIN
  if (typeof raw !== 'string' || raw.trim()==='') return null
  try {
    const origin = new URL(raw)
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname!=='/') return null
    if (origin.protocol!=='https:' && !(origin.protocol==='http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) return null
    // No same-origin redirect loops. Run the compatibility app on its own host.
    if (typeof window!=='undefined' && origin.origin===window.location.origin) return null
    return origin
  } catch { return null }
}
export function assignmentReleaseEnabled():boolean { return !!configuredOrigin() }
export function assignmentReleaseUrl(currentPath:string):string|null {
  const origin=configuredOrigin()
  if (!origin) return null
  const safePath = currentPath.startsWith('/') ? currentPath : '/welcome'
  let path = '/welcome'
  if (safePath==='/photos') path='/gallery'
  else if (safePath.startsWith('/photos/')) path='/gallery/'+encodeURIComponent(safePath.slice('/photos/'.length).split('/')[0]!)
  else if (safePath==='/editor/preview') path='/gallery'
  else if (safePath.startsWith('/assignments')) path=safePath
  else if (safePath==='/camera'||safePath==='/profile'||safePath==='/gallery') path=safePath
  else if (safePath.startsWith('/account/')) path='/welcome'
  return new URL(path,origin).href
}
export function openAssignmentRelease(screen:ReleaseScreen, photoId?:string):string|null {
  if(screen==='photos')return assignmentReleaseUrl(photoId ? '/photos/'+encodeURIComponent(photoId) : '/photos')
  if(screen==='editor')return assignmentReleaseUrl(photoId?'/photos/'+encodeURIComponent(photoId)+'/edit':'/photos')
  return assignmentReleaseUrl(screen==='welcome'?'/welcome':screen==='profile'?'/profile':screen==='assignments'?'/assignments':'/camera')
}
export const assignmentReleaseGateway:AssignmentReleaseGateway={
  get status(){return assignmentReleaseEnabled()?'external-legacy-identity' as const:'disabled' as const},
  open:openAssignmentRelease,
}
