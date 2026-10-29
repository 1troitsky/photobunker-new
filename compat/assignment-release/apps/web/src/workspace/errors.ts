import { IdentityError } from '../identity/api'
import { WorkspaceConflict } from '../studio/repository'
import { w } from './text'
export function workspaceError(error: unknown) {
  return w(
    error instanceof WorkspaceConflict ||
      (error instanceof IdentityError && error.status === 409)
      ? 'conflict'
      : error instanceof IdentityError && error.status === 422
        ? 'participantError'
        : error instanceof IdentityError &&
            [401, 403, 404, 410].includes(error.status)
          ? 'accessChanged'
          : 'unavailable',
  )
}
