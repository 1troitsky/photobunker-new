<?php
declare(strict_types=1);
namespace App\Http\Controllers;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
final class PhotoEditController extends Controller{
 public function __construct(private readonly PhotoSync $sync){}
 private function validate(Request $r,string $photoId):array{
  $this->sync->origin($r);[$account,$device]=$this->sync->actor($r);
  $photo=$this->sync->requirePhoto($photoId,$account->id,true);
  $body=P::exact($r->json()->all(),['contract','signature']);
  abort_unless(is_string($body['contract'])&&strlen($body['contract'])<=100000&&
    is_string($body['signature']),422);
  try{$contract=json_decode($body['contract'],true,48,JSON_THROW_ON_ERROR);}
  catch(\Throwable){abort(422);}
  abort_unless(is_array($contract)&&!array_is_list($contract),422);
  P::exact($contract,['v','photoId','operationId','expectedRevision','mode','asset']);
  abort_unless($contract['v']===1&&$contract['photoId']===$photoId,422);
  P::uuid($contract['operationId']);
  abort_unless(is_int($contract['expectedRevision'])&&$contract['expectedRevision']>=0
    &&$contract['expectedRevision']<500&&in_array($contract['mode'],[2,3],true),422);
  $a=$contract['asset'];abort_unless(is_array($a),422);
  P::exact($a,['assetId','kind','revision','bytes','sha256','manifest']);
  P::uuid($a['assetId']);
  $kind=$contract['mode']===2?'edit':'master';
  abort_unless($a['kind']===$kind && is_int($a['revision'])&&
   $a['revision']===$contract['expectedRevision']+1 &&
   is_int($a['bytes'])&&$a['bytes']>=16&&
   $a['bytes']<=config('photo_sync.max_asset_bytes')&&
   is_string($a['sha256'])&&preg_match('/^[0-9a-f]{64}$/D',$a['sha256']),422);
  $m=$a['manifest'];abort_unless(is_array($m),422);
  P::exact($m,['version','algorithm','chunkBytes','accountId','photoId','assetId',
    'kind','revision','expiresAt','plainBytes','cipherBytes','frames',
    'cipherDigest','wrappedDEK']);
  abort_unless($m['version']===1&&$m['algorithm']==='AES-256-GCM'&&
   $m['chunkBytes']===262144&&$m['accountId']===$account->id&&
   $m['photoId']===$photoId&&$m['assetId']===$a['assetId']&&
   $m['kind']===$kind&&$m['revision']===$a['revision']&&
   $m['expiresAt']===(int)$photo->expires_at&&$m['cipherBytes']===$a['bytes']&&
   is_int($m['plainBytes'])&&$m['plainBytes']>0&&$m['plainBytes']<=134217728&&
   is_string($m['cipherDigest'])&&preg_match('/^[0-9a-f]{64}$/D',$m['cipherDigest']),422);
  abort_unless(is_array($m['wrappedDEK']),422);
  P::exact($m['wrappedDEK'],['iv','ciphertext']);
  abort_unless(is_string($m['wrappedDEK']['iv'])&&is_string($m['wrappedDEK']['ciphertext']),422);
  P::b64($m['wrappedDEK']['iv'],12);P::b64($m['wrappedDEK']['ciphertext']);
  $frames=$m['frames'];
  abort_unless(is_array($frames)&&count($frames)===max(1,(int)ceil($m['plainBytes']/262144)),422);
  $offset=0;$clear=0;
  foreach($frames as $index=>$f){
   abort_unless(is_array($f),422);
   P::exact($f,['index','offset','bytes','plainBytes','iv','digest']);
   $size=min(262144,$m['plainBytes']-$clear);
   abort_unless($f['index']===$index&&$f['offset']===$offset&&
    $f['plainBytes']===$size&&$f['bytes']===$size+16&&
    is_string($f['iv'])&&is_string($f['digest'])&&
    preg_match('/^[0-9a-f]{64}$/D',$f['digest']),422);
   P::b64($f['iv'],12);$offset+=$f['bytes'];$clear+=$size;
  }
  abort_unless($offset===$a['bytes']&&$clear===$m['plainBytes'],422);
  abort_unless(json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$body['contract'],422);
  abort_unless(P::verify($device->signing_spki,
   "photobunker.photo-edit.v1\n".$body['contract'],$body['signature']),401);
  // The mode is frozen at shutter time. No client-side policy edits.
  $manifest=json_decode($photo->contract_json,true,64,JSON_THROW_ON_ERROR);
  $initial=$manifest['version']===2?$manifest['capture']['mode']:
   collect($manifest['assets'])->first(fn($asset)=>in_array($asset['kind'],['master','original'],true))['kind'];
  $expected=$initial==='original'?2:($initial==='master'?3:$initial);
  abort_unless($contract['mode']===$expected,403);
  return [$photo,$account,$contract,hash('sha256',$body['contract'])];
 }
 public function reserve(Request $r,string $photoId){
  [$p,$account,$c,$hash]=$this->validate($r,$photoId);
  return $this->sync->json(DB::transaction(function()use($p,$account,$c,$hash){
   $row=DB::table('photo_records')->where('id',$p->id)->lockForUpdate()->first();
   abort_if(!$row||$row->state!=='active'||$row->expires_at<=PhotoSync::nowMs(),410);
   $existing=DB::table('photo_edit_operations_v1')->where('id',$c['operationId'])->first();
   if($existing){
    abort_unless($existing->photo_id===$p->id&&$existing->account_id===$account->id&&
      hash_equals($existing->contract_hash,$hash),409);
    return ['state'=>$existing->state,'revision'=>(int)$existing->revision,'assetId'=>$existing->asset_id];
   }
   abort_unless((int)$row->edit_revision===$c['expectedRevision'],409);
   abort_unless(!DB::table('photo_edit_operations_v1')->where('photo_id',$p->id)->where('state','pending')->exists(),409);
   $a=$c['asset'];
   abort_unless(!DB::table('photo_objects')->where('id',$a['assetId'])->exists(),409);
   $need=$a['bytes'];
   $used=DB::table('photo_objects as o')->join('photo_records as p','p.id','=','o.photo_id')
    ->where('p.account_id',$account->id)->where('p.state','!=','deleting')
    ->where('p.expires_at','>',PhotoSync::nowMs())->sum('o.bytes');
   abort_unless((int)$used+$need<=config('photo_sync.account_quota_bytes'),413);
   DB::table('photo_edit_operations_v1')->insert([
    'id'=>$c['operationId'],'photo_id'=>$p->id,'account_id'=>$account->id,
    'asset_id'=>$a['assetId'],'expected_revision'=>$c['expectedRevision'],
    'revision'=>$a['revision'],'kind'=>$a['kind'],'contract_hash'=>$hash,
    'state'=>'pending','created_at'=>now(),'updated_at'=>now(),
   ]);
   DB::table('photo_objects')->insert([
    'id'=>$a['assetId'],'photo_id'=>$p->id,'kind'=>$a['kind'],'revision'=>$a['revision'],
    'bytes'=>$a['bytes'],'sha256'=>$a['sha256'],
    'manifest_json'=>json_encode($a['manifest'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
    'object_key'=>$this->sync->objectKey($account->id,$p->id,$a['assetId']),
    'edit_operation_id'=>$c['operationId'],'state'=>'pending','created_at'=>now(),'updated_at'=>now(),
   ]);
   return ['state'=>'pending','revision'=>$a['revision'],'assetId'=>$a['assetId']];
  },3));
 }
 public function upload(Request $r,string $photoId,string $assetId){
  $this->sync->origin($r);[$a]=$this->sync->actor($r);P::uuid($assetId);
  $p=$this->sync->requirePhoto($photoId,$a->id,true);
  $o=DB::table('photo_objects')->where('photo_id',$photoId)->where('id',$assetId)
    ->whereNotNull('edit_operation_id')->first();
  abort_unless($o,404);
  abort_if($o->state==='retiring',410);
  if($o->state==='active'){
   abort_unless($this->sync->verify($o->object_key,(int)$o->bytes,$o->sha256),503);
   return $this->sync->json(['verified'=>true]);
  }
  $n=$r->header('Content-Length');
  abort_unless(is_string($n)&&ctype_digit($n)&&(int)$n===(int)$o->bytes,422);
  $operation=DB::table('photo_edit_operations_v1')->where('id',$o->edit_operation_id)->first();
  abort_unless($operation && $operation->state==='pending',409);
  $active=DB::transaction(function()use($photoId,$assetId,$a){
   $photo=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
   abort_unless($photo&&$photo->account_id===$a->id&&$photo->state==='active',410);
   abort_if($photo->expires_at<=PhotoSync::nowMs(),410);
   $obj=DB::table('photo_objects')->where('id',$assetId)->lockForUpdate()->first();
   abort_unless($obj&&$obj->photo_id===$photoId,404);
   if($obj->state==='verified')return false;
   if($obj->state==='uploading'&&\Carbon\Carbon::parse($obj->updated_at)->gt(now()->subMinutes(2)))
    abort(409);
   DB::table('photo_objects')->where('id',$assetId)->update(['state'=>'uploading','updated_at'=>now()]);
   return true;
  },3);
  if($active){
   try{
    $stream=$r->getContent(true);abort_unless(is_resource($stream),422);
    try{$ok=Storage::disk(config('photo_sync.disk'))->put($o->object_key,$stream);}
    finally{fclose($stream);}
    abort_unless($ok&&$this->sync->verify($o->object_key,(int)$o->bytes,$o->sha256),503);
    DB::transaction(function()use($a,$photoId,$assetId){
     $photo=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
     abort_unless($photo&&$photo->account_id===$a->id&&$photo->state==='active'&&
       $photo->expires_at>PhotoSync::nowMs(),410);
     $asset=DB::table('photo_objects')->where('id',$assetId)->lockForUpdate()->first();
     abort_unless($asset&&$asset->photo_id===$photoId&&$asset->state==='uploading',409);
     DB::table('photo_objects')->where('id',$assetId)->update(['state'=>'verified','updated_at'=>now()]);
    },3);
   }catch(\Throwable $e){
    DB::table('photo_objects')->where('id',$assetId)->where('state','uploading')
     ->update(['state'=>'pending','updated_at'=>now()]);
    // A late stream can finish after a DELETE/TTL job already removed its
    // reference. Remove its untracked S3 key instead of leaving an orphan.
    $row=DB::table('photo_records')->where('id',$photoId)->first();
    $asset=DB::table('photo_objects')->where('id',$assetId)->first();
    if(!$row||$row->state!=='active'||$row->expires_at<=PhotoSync::nowMs()||!$asset){
     $disk=Storage::disk(config('photo_sync.disk'));
     if($disk->exists($o->object_key)&&
      (!$disk->delete($o->object_key)||$disk->exists($o->object_key)))
      abort(503,'edit.orphan_cleanup_retry');
    }
    if($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface)throw $e;
    abort(503,'edit.upload_failed');
   }
  }else abort_unless($this->sync->verify($o->object_key,(int)$o->bytes,$o->sha256),503);
  return $this->sync->json(['verified'=>true]);
 }
 public function finalize(Request $r,string $photoId){
  [$p,$a,$c,$hash]=$this->validate($r,$photoId);
  $op=DB::table('photo_edit_operations_v1')->where('id',$c['operationId'])->first();
  abort_unless($op&&$op->photo_id===$photoId&&$op->asset_id===$c['asset']['assetId']&&
   hash_equals($op->contract_hash,$hash),409);
  if($op->state==='active')return $this->sync->json(['revision'=>(int)$op->revision,'assetId'=>$op->asset_id]);
  $object=DB::table('photo_objects')->where('id',$op->asset_id)->first();
  abort_unless($object&&$object->state==='verified'&&
   $this->sync->verify($object->object_key,(int)$object->bytes,$object->sha256),503);
  $retire=[];
  $response=DB::transaction(function()use($p,$c,$op,&$retire){
   $photo=DB::table('photo_records')->where('id',$p->id)->lockForUpdate()->first();
   abort_if(!$photo||$photo->state!=='active'||$photo->expires_at<=PhotoSync::nowMs(),410);
   $now=DB::table('photo_edit_operations_v1')->where('id',$op->id)->lockForUpdate()->first();
   if($now->state==='active')return ['revision'=>(int)$now->revision,'assetId'=>$now->asset_id];
   abort_unless((int)$photo->edit_revision===$c['expectedRevision'],409);
   $candidate=DB::table('photo_objects')->where('id',$op->asset_id)->lockForUpdate()->first();
   abort_unless($candidate&&$candidate->state==='verified',409);
   $old=DB::table('photo_objects')->where('photo_id',$p->id)->where('state','active')
     ->whereIn('kind',$c['mode']===2?['edit']:['master','thumbnail'])
     ->lockForUpdate()->get();
   foreach($old as $item){
    DB::table('photo_objects')->where('id',$item->id)->update(['state'=>'retiring','updated_at'=>now()]);
    $retire[]=$item->id;
   }
   DB::table('photo_objects')->where('id',$candidate->id)->update(['state'=>'active','updated_at'=>now()]);
   DB::table('photo_records')->where('id',$p->id)->update([
    'edit_revision'=>$op->revision,'edit_asset_id'=>$candidate->id,'updated_at'=>now(),
   ]);
   DB::table('photo_edit_operations_v1')->where('id',$op->id)->update([
    'state'=>'active','updated_at'=>now(),
   ]);
   return ['revision'=>(int)$op->revision,'assetId'=>$candidate->id];
  },3);
  foreach($retire as $id)\App\Jobs\PhotoAssetCleanupJob::dispatch($photoId,$id);
  return $this->sync->json($response);
 }
}
