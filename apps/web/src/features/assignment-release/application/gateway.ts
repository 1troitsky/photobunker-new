import type {AssignmentReleaseGateway,ReleaseScreen} from '../domain/contracts'

/** PB2-only navigation contract. Old app on a second origin must never run
 * inside or intercept the PB2 identity/session/ciphertext runtime.
 */
export function assignmentReleaseEnabled():boolean{return true}
export function assignmentReleaseUrl(currentPath:string):string|null{
  if(typeof currentPath!=='string'||!currentPath.startsWith('/')||currentPath.startsWith('//'))
    return null
  if(/^\/(?:welcome|camera|profile|photos|assignments|browser|contacts|teams)$/.test(currentPath))
    return currentPath
  if(/^\/photos\/[a-f0-9-]{36}(?:\/(?:card|edit|review))?$/.test(currentPath))
    return currentPath
  if(/^\/assignments\/[a-f0-9-]{36}(?:\/edit)?$/.test(currentPath))
    return currentPath
  return null
}
export function openAssignmentRelease(screen:ReleaseScreen,photoId?:string):string|null{
  if(screen==='photos')return assignmentReleaseUrl(photoId?'/photos/'+photoId:'/photos')
  if(screen==='editor')return photoId?assignmentReleaseUrl('/photos/'+photoId+'/edit'):null
  return assignmentReleaseUrl(screen==='welcome'?'/welcome':
    screen==='profile'?'/profile':screen==='assignments'?'/assignments':'/camera')
}
export const assignmentReleaseGateway:AssignmentReleaseGateway={
  status:'native-pb2',
  open:openAssignmentRelease,
}
