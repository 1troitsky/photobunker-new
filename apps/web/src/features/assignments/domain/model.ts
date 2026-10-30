export type AssignmentStatus='waiting'|'in_progress'|'submitted'|'needs_changes'|'completed'
export type AssignmentMode=2|3
export type AssignmentAction='create'|'edit'|'transition'|'delete'
export type AssignmentFields={title:string;instructions:string;mode:AssignmentMode;retentionDays:number;
  startsAt?:string|null;finishesAt?:string|null;targetCount?:number|null;archived?:boolean}
export type PolicySnapshot=Readonly<{assignmentId:string;assignmentRevision:number;
  policyRevision:number;mode:AssignmentMode;retentionDays:number}>
export type AssignmentView=AssignmentFields&{id:string;status:AssignmentStatus;revision:number;
  policyRevision:number;sync:'local'|'retry'|'synced'|'conflict';createdAt:string|null;updatedAt:string|null}
export const steps:Readonly<Record<AssignmentStatus,readonly AssignmentStatus[]>>={
  waiting:['in_progress'],in_progress:['submitted'],submitted:['needs_changes','completed'],
  needs_changes:['in_progress'],completed:[],
}
function illegalControl(text:string,allowTabLf=false):boolean{
  for(const char of text){
    const code=char.charCodeAt(0)
    if(code<32&&(!allowTabLf||(code!==9&&code!==10)))return true
  }
  return false
}
export function validateFields(fields:AssignmentFields):AssignmentFields{
  const title=fields.title.trim()
  if(!title||title.length>80||illegalControl(title))throw Error('assignment.title_invalid')
  if(typeof fields.instructions!=='string'||fields.instructions.length>4000||
    illegalControl(fields.instructions,true))throw Error('assignment.instructions_invalid')
  if(fields.mode!==2&&fields.mode!==3)throw Error('assignment.mode_unavailable')
  if(!Number.isInteger(fields.retentionDays)||fields.retentionDays<1||fields.retentionDays>45)
    throw Error('assignment.retention_invalid')
  // Private planning fields stay inside the existing encrypted assignment envelope.
  // Do not leak dates or targets into the signed public capture policy.
  const startsAt=fields.startsAt||null,finishesAt=fields.finishesAt||null
  const validDay=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&
    !Number.isNaN(Date.parse(date+'T00:00:00Z'))&&
    new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date
  if(startsAt&&!validDay(startsAt)||finishesAt&&!validDay(finishesAt)||
    startsAt&&finishesAt&&startsAt>finishesAt)throw Error('assignment.dates_invalid')
  if(fields.archived!==undefined&&typeof fields.archived!=='boolean')
    throw Error('assignment.archived_invalid')
  const targetCount=fields.targetCount??null
  if(targetCount!==null&&(!Number.isInteger(targetCount)||targetCount<1||targetCount>9999))
    throw Error('assignment.target_invalid')
  return{title,instructions:fields.instructions,mode:fields.mode,retentionDays:fields.retentionDays,
    startsAt,finishesAt,targetCount,archived:fields.archived??false}
}
export function nextStatus(before:AssignmentStatus,after:AssignmentStatus):void{
  if(!steps[before].includes(after))throw Error('assignment.invalid_transition')
}
export function policySnapshot(view:AssignmentView):PolicySnapshot{
  return{assignmentId:view.id,assignmentRevision:view.revision,
    policyRevision:view.policyRevision,mode:view.mode,retentionDays:view.retentionDays}
}
