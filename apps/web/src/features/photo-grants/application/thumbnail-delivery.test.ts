import {describe,it,expect} from 'vitest'
import {thumbnailShareOutcome} from './thumbnail-delivery'
describe('durable signed thumbnail delivery policy',()=>{
  it('acknowledges only an explicit matching signed operation receipt',()=>{
    const id=crypto.randomUUID()
    expect(thumbnailShareOutcome(200,{accepted:true,operationId:id},id)).toBe('ack')
    expect(thumbnailShareOutcome(200,{accepted:true,operationId:crypto.randomUUID()},id)).toBe('retry')
    expect(thumbnailShareOutcome(200,{accepted:false,operationId:id},id)).toBe('retry')
    expect(thumbnailShareOutcome(204,null,id)).toBe('retry')
  })
  it('never creates a new share when the server is ambiguous or unavailable',()=>{
    const id=crypto.randomUUID()
    for(const status of [null,401,408,429,500,503])
      expect(thumbnailShareOutcome(status,null,id)).toBe('retry')
    for(const status of [400,403,404,409,410,422])
      expect(thumbnailShareOutcome(status,null,id)).toBe('conflict')
  })
})
