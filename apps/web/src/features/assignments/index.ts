/** Public application boundary. UI never imports PB2 crypto/IndexedDB/HTTP. */
export {openAssignments} from './infrastructure/repository'
export {flushAssignments,startAssignmentSync,onAssignmentChange,fetchServerAssignment,fetchAssignmentProgress} from './infrastructure/sync'
export {steps,validateFields,policySnapshot} from './domain/model'
export type {AssignmentView,AssignmentStatus,AssignmentMode,AssignmentFields,PolicySnapshot} from './domain/model'

export {inspectAssignmentPending} from './infrastructure/database'
