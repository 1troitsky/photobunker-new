import {acquireStorageKeys} from '../../identity'
import {assignmentDb,assignmentKey,operationKey,type Row,type Operation} from './database'
import {seal,unseal,type AssignmentContract} from './crypto'
import {nextStatus,validateFields,policySnapshot,type AssignmentView,
  type AssignmentFields,type AssignmentStatus,type AssignmentAction} from '../domain/model'
type Grant=ReturnType<typeof acquireStorageKeys>
export type ServerAssignment={assignmentId:string;status:AssignmentStatus;revision:number;
  policyRevision:number;mode:2|3;retentionDays:number;envelope:Row['envelope'];
  createdAt:string;updatedAt:string}
export class AssignmentRepository{
  private grant:Grant=acquireStorageKeys()
  private account=this.grant.scope.accountId
  check():void{this.grant.check()}
  private async record(id:string):Promise<Row>{
    this.check()
    const key=assignmentKey(this.account,id)
    if(await assignmentDb.tombstones.get(key))throw Error('assignment.deleted')
    const row=await assignmentDb.assignments.get(key)
    this.check()
    if(!row||row.deleted)throw Error('assignment.not_found')
    return row
  }
  private async project(row:Row):Promise<AssignmentView>{
    const clear=await unseal(this.grant,row.envelope)
    this.check()
    const ops=await assignmentDb.operations.where('[accountId+assignmentId]')
      .equals([this.account,row.assignmentId]).filter(o=>o.state==='pending'||o.state==='retry'||o.state==='conflict').toArray()
    return{...clear,id:row.assignmentId,status:row.status,revision:row.revision,
      policyRevision:row.policyRevision,mode:row.mode,retentionDays:row.retentionDays,
      sync:row.conflict||ops.some(o=>o.state==='conflict')?'conflict':
        ops.some(o=>o.state==='retry')?'retry':ops.length?'local':'synced',
      createdAt:row.createdAt,updatedAt:row.updatedAt}
  }
  async get(id:string):Promise<AssignmentView>{return this.project(await this.record(id))}
  async list():Promise<AssignmentView[]>{
    this.check()
    const rows=await assignmentDb.assignments.where('accountId').equals(this.account).toArray()
    const items:AssignmentView[]=[]
    for(const row of rows){
      if(row.deleted||await assignmentDb.tombstones.get(row.key))continue
      try{items.push(await this.project(row))}catch{this.check()} // malformed ciphertext never treated as valid
    }
    this.check()
    items.sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')||a.id.localeCompare(b.id))
    return items
  }
  async create(fields:AssignmentFields):Promise<AssignmentView>{
    this.check();fields=validateFields(fields)
    const assignmentId=crypto.randomUUID(),operationId=crypto.randomUUID()
    const envelope=await seal(this.grant,assignmentId,operationId,1,fields)
    const contract:AssignmentContract={version:1,assignmentId,operationId,
      expectedRevision:0,revision:1,action:'create',status:'waiting',
      policyRevision:1,mode:fields.mode,retentionDays:fields.retentionDays,envelope}
    const row:Row={key:assignmentKey(this.account,assignmentId),accountId:this.account,assignmentId,
      status:'waiting',revision:1,policyRevision:1,mode:fields.mode,retentionDays:fields.retentionDays,
      envelope,createdAt:null,updatedAt:null,deleted:false,conflict:false}
    await assignmentDb.transaction('rw',[assignmentDb.assignments,assignmentDb.operations,assignmentDb.tombstones],async()=>{
      this.check()
      if(await assignmentDb.tombstones.get(row.key))throw Error('assignment.deleted')
      await assignmentDb.assignments.add(row)
      await assignmentDb.operations.add(this.operation(contract))
    })
    this.wake()
    return this.project(row)
  }
  async duplicate(id:string):Promise<AssignmentView>{
    const source=await this.get(id)
    return this.create({...source,archived:false})
  }
  private operation(contract:AssignmentContract):Operation{
    return{key:operationKey(this.account,contract.operationId),accountId:this.account,
      assignmentId:contract.assignmentId,operationId:contract.operationId,contract,
      state:'pending',attempts:0,nextAttemptAt:0}
  }
  private wake():void{if(typeof window!=='undefined')window.dispatchEvent(new Event('photobunker-assignment-outbox'))}
  private async apply(id:string,action:Exclude<AssignmentAction,'create'>,
    nextFields?:AssignmentFields,nextState?:AssignmentStatus):Promise<AssignmentView|null>{
    const previous=await this.record(id)
    const before=await this.project(previous)
    const fields=action==='edit'?validateFields(nextFields!):validateFields({...before})
    const status=action==='transition'?nextState!:before.status
    if(action==='transition')nextStatus(before.status,status)
    if(action==='edit'&&before.status==='completed'){
      const onlyArchive=fields.archived!==before.archived&&
        fields.title===before.title&&fields.instructions===before.instructions&&
        fields.mode===before.mode&&fields.retentionDays===before.retentionDays&&
        fields.startsAt===before.startsAt&&fields.finishesAt===before.finishesAt&&
        fields.targetCount===before.targetCount&&
        fields.cameraInstructions===before.cameraInstructions&&
        fields.requiredGps===before.requiredGps&&fields.requireDescription===before.requireDescription&&
        fields.descriptionMinLength===before.descriptionMinLength&&
        fields.requireTags===before.requireTags&&
        JSON.stringify(fields.allowedTags)===JSON.stringify(before.allowedTags)&&
        fields.enableNameId===before.enableNameId&&fields.allowEditing===before.allowEditing&&
        fields.keepOriginal===before.keepOriginal&&fields.allowDeletion===before.allowDeletion&&
        fields.allowBrowsing===before.allowBrowsing&&fields.capturePreset===before.capturePreset
      if(!onlyArchive)throw Error('assignment.completed')
    }
    const revision=previous.revision+1
    const captureKeys=['mode','retentionDays','cameraInstructions','requiredGps',
      'requireDescription','descriptionMinLength','requireTags','allowedTags',
      'enableNameId','allowEditing','keepOriginal','allowDeletion','allowBrowsing',
      'capturePreset'] as const
    const policyRevision=previous.policyRevision+(action==='edit'&&
      captureKeys.some(key=>JSON.stringify(fields[key])!==JSON.stringify(before[key]))?1:0)
    const operationId=crypto.randomUUID()
    const envelope=action==='delete'?null:await seal(this.grant,id,operationId,revision,fields)
    const contract:AssignmentContract={version:1,assignmentId:id,operationId,expectedRevision:previous.revision,
      revision,action,status,policyRevision,mode:fields.mode,retentionDays:fields.retentionDays,envelope}
    const row:Row={...previous,revision,status,policyRevision,mode:fields.mode,
      retentionDays:fields.retentionDays,envelope:envelope??previous.envelope,
      updatedAt:null,deleted:action==='delete'}
    await assignmentDb.transaction('rw',[assignmentDb.assignments,assignmentDb.operations,assignmentDb.tombstones],async()=>{
      this.check()
      const actual=await assignmentDb.assignments.get(row.key)
      if(!actual||actual.deleted||actual.revision!==previous.revision)throw Error('assignment.local_conflict')
      if(await assignmentDb.tombstones.get(row.key))throw Error('assignment.deleted')
      await assignmentDb.assignments.put(row)
      await assignmentDb.operations.add(this.operation(contract))
      if(action==='delete')await assignmentDb.tombstones.put({
        key:row.key,accountId:this.account,assignmentId:id})
    })
    this.wake()
    return action==='delete'?null:this.project(row)
  }
  async edit(id:string,fields:AssignmentFields):Promise<AssignmentView>{
    return (await this.apply(id,'edit',fields))!
  }
  async setArchived(id:string,archived:boolean):Promise<AssignmentView>{
    const before=await this.get(id)
    if(before.archived===archived)return before
    return this.edit(id,{...before,archived})
  }
  async transition(id:string,status:AssignmentStatus):Promise<AssignmentView>{
    return (await this.apply(id,'transition',undefined,status))!
  }
  async remove(id:string):Promise<void>{await this.apply(id,'delete')}
  async pending():Promise<Operation[]>{
    this.check()
    return (await assignmentDb.operations.where('accountId').equals(this.account).toArray())
      .filter(o=>o.state==='pending'||o.state==='retry')
      .sort((a,b)=>a.assignmentId.localeCompare(b.assignmentId)||a.contract.revision-b.contract.revision)
  }
  async acknowledge(op:Operation,receipt:{revision:number;acceptedAt?:string;deleted?:boolean}):Promise<void>{
    this.check()
    if(receipt.revision!==op.contract.revision)throw Error('assignment.ack_invalid')
    await assignmentDb.transaction('rw',[assignmentDb.assignments,assignmentDb.operations],async()=>{
      this.check()
      const saved=await assignmentDb.operations.get(op.key)
      if(!saved||JSON.stringify(saved.contract)!==JSON.stringify(op.contract))throw Error('assignment.op_changed')
      if(saved.state==='discarded')return
      await assignmentDb.operations.update(op.key,{state:'acknowledged',error:undefined})
      const row=await assignmentDb.assignments.get(assignmentKey(this.account,op.assignmentId))
      if(row?.revision===receipt.revision){
        if(op.contract.action==='delete')await assignmentDb.assignments.delete(row.key)
        else await assignmentDb.assignments.update(row.key,{
          conflict:false,updatedAt:receipt.acceptedAt??row.updatedAt,
          createdAt:row.createdAt??receipt.acceptedAt??null,
        })
      }
    })
  }
  async fail(op:Operation,code:string,conflict=false):Promise<void>{
    this.check()
    await assignmentDb.transaction('rw',[assignmentDb.operations,assignmentDb.assignments],async()=>{
      this.check()
      const saved=await assignmentDb.operations.get(op.key)
      if(!saved||saved.state==='acknowledged'||saved.state==='discarded')return
      const attempts=Math.min(25,saved.attempts+1)
      await assignmentDb.operations.update(op.key,{
        state:conflict?'conflict':'retry',attempts,
        nextAttemptAt:conflict?0:Date.now()+Math.min(300000,1000*2**Math.min(attempts,8)),
        error:code.slice(0,70),
      })
      if(conflict)await assignmentDb.assignments.update(assignmentKey(this.account,op.assignmentId),{conflict:true})
    })
  }
  async mergeServer(returns:ServerAssignment[]):Promise<void>{
    this.check()
    // A local draft or pending deletion is stronger than a stale remote list.
    for(const record of returns){
      this.check()
      const key=assignmentKey(this.account,record.assignmentId)
      if(await assignmentDb.tombstones.get(key))continue
      const ops=await assignmentDb.operations.where('[accountId+assignmentId]')
        .equals([this.account,record.assignmentId]).filter(o=>o.state==='pending'||o.state==='retry'||o.state==='conflict').count()
      if(ops)continue
      if(record.envelope.accountId!==this.account||record.envelope.assignmentId!==record.assignmentId||
        record.envelope.revision!==record.revision||!['waiting','in_progress','submitted','needs_changes','completed'].includes(record.status)||
        (record.mode!==2&&record.mode!==3)||record.retentionDays<1||record.retentionDays>45)continue
      // Verify authenticated ciphertext *before* making it visible or durable.
      await unseal(this.grant,record.envelope)
      await assignmentDb.transaction('rw',[assignmentDb.assignments,assignmentDb.operations,assignmentDb.tombstones],async()=>{
        this.check()
        if(await assignmentDb.tombstones.get(key))return
        if(await assignmentDb.operations.where('[accountId+assignmentId]').equals([this.account,record.assignmentId])
          .filter(o=>o.state==='pending'||o.state==='retry'||o.state==='conflict').count())return
        const current=await assignmentDb.assignments.get(key)
        if(current && current.revision>record.revision)return
        await assignmentDb.assignments.put({key,accountId:this.account,assignmentId:record.assignmentId,
          status:record.status,revision:record.revision,policyRevision:record.policyRevision,
          mode:record.mode,retentionDays:record.retentionDays,
          envelope:record.envelope,createdAt:record.createdAt,updatedAt:record.updatedAt,
          deleted:false,conflict:false})
      })
    }
  }
  async conflicts():Promise<Operation[]>{
    this.check()
    return assignmentDb.operations.where('accountId').equals(this.account)
      .filter(o=>o.state==='conflict').toArray()
  }
  /** Owner explicitly picks a resolution; rejected ciphertext remains in durable discarded op rows. */
  async resolve(id:string,remote:ServerAssignment,retry:boolean):Promise<void>{
    const local=await this.record(id)
    if(!local.conflict)throw Error('assignment.no_conflict')
    if(remote.assignmentId!==id)throw Error('assignment.id_mismatch')
    const clear=await unseal(this.grant,remote.envelope)
    const previous=await unseal(this.grant,local.envelope)
    if(retry&&local.status!==remote.status)throw Error('assignment.status_conflict_compare_first')
    if(retry&&remote.status==='completed')throw Error('assignment.completed')
    await assignmentDb.transaction('rw',[assignmentDb.assignments,assignmentDb.operations],async()=>{
      this.check()
      const live=await assignmentDb.assignments.get(local.key)
      if(!live||!live.conflict||live.revision!==local.revision)throw Error('assignment.local_conflict')
      const ops=await assignmentDb.operations.where('[accountId+assignmentId]')
        .equals([this.account,id]).filter(o=>o.state==='pending'||o.state==='retry'||o.state==='conflict').toArray()
      for(const op of ops)await assignmentDb.operations.update(op.key,{state:'discarded'})
      await assignmentDb.assignments.put({
        key:local.key,accountId:this.account,assignmentId:id,status:remote.status,
        revision:remote.revision,policyRevision:remote.policyRevision,mode:remote.mode,
        retentionDays:remote.retentionDays,envelope:remote.envelope,
        createdAt:remote.createdAt,updatedAt:remote.updatedAt,deleted:false,conflict:false,
      })
    })
    void clear // validated before persistence
    if(retry){
      await this.edit(id,{...previous,mode:local.mode,retentionDays:local.retentionDays})
    }
  }
  async resetToServer(id:string,remote:ServerAssignment):Promise<void>{
    await this.resolve(id,remote,false)
  }
  async retryDraft(id:string,remote:ServerAssignment):Promise<void>{
    await this.resolve(id,remote,true)
  }
  async snapshot(id:string){return policySnapshot(await this.get(id))}
}
export const openAssignments=()=>new AssignmentRepository()
