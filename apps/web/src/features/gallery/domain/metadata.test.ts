import {describe,expect,it} from 'vitest'
import {formatName,namePattern,checkFix,checkMetadata} from './metadata'
describe('R2-07 immutable NAME-ID and private v1 fields',()=>{
 it('retains old exact boundaries and rejects malformed codes',()=>{
   expect(formatName('ABCD',1)).toBe('ABCD0001')
   expect(formatName('ABCD',9999)).toBe('ABCD9999')
   expect(formatName('AAAA',14)).toBe('AAAA0014')
   for(const value of [0,-1,10000,0.5,NaN,Infinity])expect(()=>formatName('ABCD',value)).toThrow()
   for(const prefix of ['abcD','ABC','ABCDE','AB-D','1BCD'])expect(()=>formatName(prefix,1)).toThrow()
   expect(namePattern.test('ABCD-X7K9P2M5QR')).toBe(false)
   expect(namePattern.test('ABCD10000')).toBe(false)
 })
 it('checks GPS ranges, freshness fields and title string limits',()=>{
   expect(checkFix({source:'gps',status:'ready',latitude:41.72,longitude:44.77,
     accuracy:15,measuredAt:1700000000000}).latitude).toBe(41.72)
   for(const x of [-91,91,Infinity,NaN])expect(()=>checkFix({
     source:'gps',status:'ready',latitude:x,longitude:0,accuracy:10,measuredAt:1700000000000})).toThrow()
   expect(()=>checkFix({source:'gps',status:'ready',latitude:0,longitude:190,
     accuracy:10,measuredAt:1700000000000})).toThrow()
   expect(()=>checkMetadata({policyVersion:1,mode:3,capturedAt:1700000000000,
     expiresAt:1700010000000,outputWidth:320,outputHeight:240,
     mime:'image/jpeg',title:'a'.repeat(161)})).toThrow()
 })
})
