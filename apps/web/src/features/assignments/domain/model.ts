export type AssignmentStatus='waiting'|'in_progress'|'submitted'|'needs_changes'|'completed'
export type AssignmentMode=2|3
export type AssignmentAction='create'|'edit'|'transition'|'delete'
export type AssignmentFields={title:string;instructions:string;mode:AssignmentMode;retentionDays:number}
export type PolicySnapshot=Readonly<{assignmentId:string;assignmentRevision:number;
  policyRevision:number;mode:AssignmentMode;retentionDays:number}>
export type AssignmentView=AssignmentFields&{id:string;status:AssignmentStatus;revision:number;
  policyRevision:number;sync:'local'|'retry'|'synced'|'conflict';createdAt:string|null;updatedAt:string|null}
export const steps:Readonly<Record<AssignmentStatus,readonly AssignmentStatus[]>>={
  waiting:['in_progress'],in_progress:['submitted'],submitted:['needs_changes','completed'],
  needs_changes:['in_progress'],completed:[],
}
export function validateFields(fields:AssignmentFields):AssignmentFields{
  const title=fields.title.trim()
  if(!title||title.length>80||/[\u0000-\u001f]/.test(title))throw Error('assignment.title_invalid')
  if(typeof fields.instructions!=='string'||fields.instructions.length>4000||
    /[\u0000-\u0008\u000b-\u001f]/.test(fields.instructions))throw Error('assignment.instructions_invalid')
  if(fields.mode!==2&&fields.mode!==3)throw Error('assignment.mode_unavailable')
  if(!Number.isInteger(fields.retentionDays)||fields.retentionDays<1||fields.retentionDays>45)
    throw Error('assignment.retention_invalid')
  return{title,instructions:fields.instructions,mode:fields.mode,retentionDays:fields.retentionDays}
}
export function nextStatus(before:AssignmentStatus,after:AssignmentStatus):void{
  if(!steps[before].includes(after))throw Error('assignment.invalid_transition')
}
export function policySnapshot(view:AssignmentView):PolicySnapshot{
  return{assignmentId:view.id,assignmentRevision:view.revision,
    policyRevision:view.policyRevision,mode:view.mode,retentionDays:view.retentionDays}
}
