import type {PhotoHeader} from './contracts'
/**
 * The initial signed capture snapshot is immutable; local editing must not
 * replace its upload assets before the original ciphertext reaches the server.
 * Never infer the initial master by revision: mode-3 edit #1 is revision 1 too.
 */
export type OriginalUploadPointers=Readonly<{
  primary:string;metadata:string;thumbnail:string|null
}>
export function originalUploadPointers(header:Pick<PhotoHeader,
  'assetId'|'metadataAssetId'|'thumbnailAssetId'|'initialAssetId'|'initialThumbnailAssetId'>):
  OriginalUploadPointers{
  const primary=header.initialAssetId??header.assetId
  const metadata=header.metadataAssetId
  const thumbnail=header.initialThumbnailAssetId??header.thumbnailAssetId??null
  const uuid=/^[a-f0-9-]{36}$/
  if(!uuid.test(primary)||!uuid.test(metadata)||primary===metadata||
    thumbnail!==null&&(!uuid.test(thumbnail)||thumbnail===primary||thumbnail===metadata))
    throw Error('sync.invalid_initial_assets')
  return {primary,metadata,thumbnail}
}
