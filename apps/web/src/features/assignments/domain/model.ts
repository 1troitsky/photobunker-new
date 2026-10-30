export type AssignmentStatus='waiting'|'in_progress'|'submitted'|'needs_changes'|'completed'
export type AssignmentMode=2|3
export type AssignmentAction='create'|'edit'|'transition'|'archive'|'delete'
export type AssignmentFields={title:string;instructions:string;mode:AssignmentMode;retentionDays:number;
  startsAt?:string|null;finishesAt?:string|null;targetCount?:number|null;archived?:boolean;
  cameraInstructions?:string;requiredGps?:boolean;requireDescription?:boolean;
  descriptionMinLength?:number;requireTags?:boolean;allowedTags?:string[];
  enableNameId?:boolean;allowEditing?:boolean;keepOriginal?:boolean;
  allowDeletion?:boolean;allowBrowsing?:boolean;capturePreset?:string|null}
export type PolicySnapshot=Readonly<{assignmentId:string;assignmentRevision:number;
  policyRevision:number;mode:AssignmentMode;retentionDays:number;
  requiredGps?:boolean;enableNameId?:boolean;startsAt?:string|null;finishesAt?:string|null;
  requireDescription?:boolean;descriptionMinLength?:number;requireTags?:boolean;allowedTags?:string[]}>
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
  const cameraInstructions=fields.cameraInstructions??''
  if(typeof cameraInstructions!=='string'||cameraInstructions.length>2000||
    illegalControl(cameraInstructions,true))throw Error('assignment.camera_instructions_invalid')
  const booleanFields=['requiredGps','requireDescription','requireTags','enableNameId',
    'allowEditing','keepOriginal','allowDeletion','allowBrowsing'] as const
  for(const field of booleanFields){
    if(fields[field]!==undefined&&typeof fields[field]!=='boolean')
      throw Error('assignment.policy_invalid')
  }
  const descriptionMinLength=fields.descriptionMinLength??0
  if(!Number.isInteger(descriptionMinLength)||descriptionMinLength<0||descriptionMinLength>2000)
    throw Error('assignment.description_min_invalid')
  const rawTags=fields.allowedTags??[]
  if(!Array.isArray(rawTags)||rawTags.length>30||
    rawTags.some(tag=>typeof tag!=='string'||tag.length>40||!tag.trim()||
      illegalControl(tag)))throw Error('assignment.tags_invalid')
  const allowedTags=[...new Set(rawTags.map(tag=>tag.trim()))]
  const capturePreset=fields.capturePreset??null
  if(capturePreset!==null&&(typeof capturePreset!=='string'||capturePreset.length>80||
    illegalControl(capturePreset)))throw Error('assignment.preset_invalid')
  const targetCount=fields.targetCount??null
  if(targetCount!==null&&(!Number.isInteger(targetCount)||targetCount<1||targetCount>9999))
    throw Error('assignment.target_invalid')
  return{title,instructions:fields.instructions,mode:fields.mode,retentionDays:fields.retentionDays,
    startsAt,finishesAt,targetCount,archived:fields.archived??false,
    cameraInstructions,requiredGps:fields.requiredGps??false,
    requireDescription:fields.requireDescription??false,descriptionMinLength,
    requireTags:fields.requireTags??false,allowedTags,
    enableNameId:fields.enableNameId??true,allowEditing:fields.allowEditing??true,
    keepOriginal:fields.keepOriginal??false,allowDeletion:fields.allowDeletion??true,
    allowBrowsing:fields.allowBrowsing??false,capturePreset}
}
export function nextStatus(before:AssignmentStatus,after:AssignmentStatus):void{
  if(!steps[before].includes(after))throw Error('assignment.invalid_transition')
}
export function policySnapshot(view:AssignmentView):PolicySnapshot{
  return{assignmentId:view.id,assignmentRevision:view.revision,
    policyRevision:view.policyRevision,mode:view.mode,retentionDays:view.retentionDays,
    requiredGps:view.requiredGps??false,enableNameId:view.enableNameId??true,
    startsAt:view.startsAt??null,finishesAt:view.finishesAt??null,
    requireDescription:view.requireDescription??false,
    descriptionMinLength:view.descriptionMinLength??0,
    requireTags:view.requireTags??false,allowedTags:view.allowedTags??[]}
}
