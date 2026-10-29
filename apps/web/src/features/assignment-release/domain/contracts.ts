/** The public Assignment Release migration port. No PB2 identity or photo SDK. */
export type ReleaseScreen = 'assignments'|'camera'|'photos'|'editor'|'welcome'|'profile'
export type ReleaseStatus = 'disabled'|'external-legacy-identity'
export type ConfirmedProgress = Readonly<{ assignmentId:string; required:number; serverConfirmed:number; verifiedAt:number }>
export type GpsCaptureEvidence = Readonly<{ latitude:number; longitude:number; accuracyMeters:number; measuredAt:number }>
export interface AssignmentReleaseGateway {
  readonly status: ReleaseStatus
  open(screen:ReleaseScreen, photoId?:string):string|null
}
