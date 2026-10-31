import {describe,it,expect} from 'vitest'
import {originalUploadPointers} from './original-upload'
const id=()=>crypto.randomUUID()
describe('offline edit must preserve the shutter-time photo upload',()=>{
  it('retains initial primary + initial thumbnail after mode-3 local replacement',()=>{
    const primary=id(),meta=id(),thumb=id(),edited=id()
    const actual=originalUploadPointers({assetId:edited,metadataAssetId:meta,
      initialAssetId:primary,initialThumbnailAssetId:thumb})
    expect(actual).toEqual({primary,metadata:meta,thumbnail:thumb})
    expect(actual.primary).not.toBe(edited)
  })
  it('falls back to current pointers before the first local edit',()=>{
    const primary=id(),metadata=id()
    expect(originalUploadPointers({assetId:primary,metadataAssetId:metadata}))
      .toEqual({primary,metadata,thumbnail:null})
  })
  it('refuses malformed/duplicated initial snapshot identities',()=>{
    const x=id()
    expect(()=>originalUploadPointers({assetId:x,metadataAssetId:x})).toThrow()
    expect(()=>originalUploadPointers({assetId:x,metadataAssetId:id(),
      initialThumbnailAssetId:x})).toThrow()
  })
})
