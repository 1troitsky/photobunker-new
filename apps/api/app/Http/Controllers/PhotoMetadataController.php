<?php
declare(strict_types=1);
namespace App\Http\Controllers;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
final class PhotoMetadataController extends Controller{
  public function __construct(private readonly PhotoSync $sync){}
  private function parsed(Request $r,string $id):array{
    $this->sync->origin($r);[$a,$device]=$this->sync->actor($r);
    $p=$this->sync->requirePhoto($id,$a->id,true);
    $d=P::exact($r->json()->all(),['operationId','expectedRevision','asset','signature']);
    P::uuid($d['operationId']);
    abort_unless(is_int($d['expectedRevision'])&&$d['expectedRevision']>=1,422);
    $o=$d['asset'];abort_unless(is_array($o),422);
    P::exact($o,['assetId','kind','revision','bytes','sha256','manifest']);
    P::uuid($o['assetId']);abort_unless($o['kind']==='metadata'&&$o['revision']===$d['expectedRevision']+1,422);
    abort_unless(is_int($o['bytes'])&&$o['bytes']>=16&&$o['bytes']<=1048576&&
      is_string($o['sha256'])&&preg_match('/^[a-f0-9]{64}$/D',$o['sha256']),422);
    $m=$o['manifest'];abort_unless(is_array($m),422);
    P::exact($m,['version','algorithm','chunkBytes','accountId','photoId','assetId','kind',
      'revision','expiresAt','plainBytes','cipherBytes','frames','cipherDigest','wrappedDEK']);
    abort_unless($m['version']===1&&$m['accountId']===$a->id&&$m['photoId']===$id&&
      $m['assetId']===$o['assetId']&&$m['kind']==='metadata'&&$m['revision']===$o['revision']
      &&$m['expiresAt']===(int)$p->expires_at&&$m['cipherBytes']===$o['bytes'],422);
    abort_unless($m['algorithm']==='AES-256-GCM'&&$m['chunkBytes']===262144
      &&is_int($m['plainBytes'])&&$m['plainBytes']>=0&&$m['plainBytes']<=1048576
      &&is_array($m['frames'])&&count($m['frames'])===max(1,(int)ceil($m['plainBytes']/262144))
      &&is_string($m['cipherDigest'])&&preg_match('/^[a-f0-9]{64}$/D',$m['cipherDigest']),422);
    abort_unless(is_array($m['wrappedDEK'])&&
      array_keys($m['wrappedDEK'])===['iv','ciphertext']&&
      is_string($m['wrappedDEK']['iv'])&&is_string($m['wrappedDEK']['ciphertext']),422);
    P::b64($m['wrappedDEK']['iv'],12);P::b64($m['wrappedDEK']['ciphertext']);
    $offset=0;$plain=0;
    foreach($m['frames'] as $index=>$f){
      abort_unless(is_array($f),422);
      P::exact($f,['index','offset','bytes','plainBytes','iv','digest']);
      $size=min(262144,$m['plainBytes']-$plain);
      abort_unless($f['index']===$index&&$f['offset']===$offset&&
        $f['plainBytes']===$size&&$f['bytes']===$size+16&&
        is_string($f['digest'])&&preg_match('/^[a-f0-9]{64}$/D',$f['digest'])&&is_string($f['iv']),422);
      P::b64($f['iv'],12);$offset+=$f['bytes'];$plain+=$size;
    }
    abort_unless($offset===$m['cipherBytes']&&$plain===$m['plainBytes'],422);
    $signed=json_encode(['photoId'=>$id,'operationId'=>$d['operationId'],
      'expectedRevision'=>$d['expectedRevision'],'asset'=>$o],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    abort_unless(is_string($d['signature'])&&P::verify($device->signing_spki,
      "photobunker.photo-metadata.v1\n".$signed,$d['signature']),401);
    return [$p,$d,$o,$signed];
  }
  public function reserve(Request $r,string $id){
    [$p,$d,$o]=$this->parsed($r,$id);
    return $this->sync->json(DB::transaction(function()use($p,$d,$o){
      $row=DB::table('photo_records')->where('id',$p->id)->lockForUpdate()->first();
      abort_if($row->state!=='active'||$row->expires_at<=PhotoSync::nowMs(),410);
      $existing=DB::table('photo_objects')->where('id',$o['assetId'])->first();
      if($existing){abort_unless($existing->photo_id===$p->id&&$existing->revision===$o['revision']&&
        $existing->sha256===$o['sha256']&&$existing->bytes===$o['bytes'],409);
        return ['state'=>$row->metadata_asset_id===$o['assetId']?'active':'pending'];
      }
      abort_unless((int)$row->metadata_revision===$d['expectedRevision'],409);
      DB::table('photo_objects')->insert(['id'=>$o['assetId'],'photo_id'=>$p->id,
        'kind'=>'metadata','revision'=>$o['revision'],'bytes'=>$o['bytes'],'sha256'=>$o['sha256'],
        'manifest_json'=>json_encode($o['manifest'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
        'object_key'=>$this->sync->objectKey($p->account_id,$p->id,$o['assetId']),
        'state'=>'pending','created_at'=>now(),'updated_at'=>now()]);
      return ['state'=>'pending'];
    },3));
  }
  public function upload(Request $r,string $id,string $assetId){
    $this->sync->origin($r);[$a]=$this->sync->actor($r);P::uuid($assetId);
    $p=$this->sync->requirePhoto($id,$a->id,true);
    $o=DB::table('photo_objects')->where('photo_id',$id)->where('id',$assetId)->where('kind','metadata')->first();
    abort_unless($o,404);abort_if($o->state==='active',409);
    $length=$r->header('Content-Length');
    abort_unless(is_string($length)&&ctype_digit($length)&&(int)$length===(int)$o->bytes,422);
    $stream=$r->getContent(true);abort_unless(is_resource($stream),422);
    try{$ok=Storage::disk(config('photo_sync.disk'))->put($o->object_key,$stream);}
    finally{fclose($stream);}
    abort_unless($ok&&$this->sync->verify($o->object_key,(int)$o->bytes,$o->sha256),503);
    DB::table('photo_objects')->where('id',$o->id)->where('state','pending')
       ->update(['state'=>'verified','updated_at'=>now()]);
    return $this->sync->json(['verified'=>true]);
  }
  public function finalize(Request $r,string $id){
    [$p,$d,$o]=$this->parsed($r,$id);
    $saved=DB::table('photo_objects')->where('photo_id',$id)->where('id',$o['assetId'])->first();
    abort_unless($saved,409);
    if($p->metadata_asset_id===$o['assetId'])return $this->sync->json(['revision'=>(int)$p->metadata_revision,'assetId'=>$o['assetId']]);
    abort_unless($saved->state==='verified'&&$this->sync->verify($saved->object_key,(int)$saved->bytes,$saved->sha256),503);
    $old=null;
    $reply=DB::transaction(function()use($p,$o,$d,&$old){
      $row=DB::table('photo_records')->where('id',$p->id)->lockForUpdate()->first();
      abort_if($row->state!=='active'||$row->expires_at<=PhotoSync::nowMs(),410);
      if($row->metadata_asset_id===$o['assetId'])return ['revision'=>(int)$row->metadata_revision,'assetId'=>$o['assetId']];
      abort_unless((int)$row->metadata_revision===$d['expectedRevision'],409);
      $old=$row->metadata_asset_id;
      DB::table('photo_records')->where('id',$p->id)->update([
        'metadata_asset_id'=>$o['assetId'],'metadata_revision'=>$o['revision'],'updated_at'=>now(),
      ]);
      DB::table('photo_objects')->where('id',$o['assetId'])->update(['state'=>'active','updated_at'=>now()]);
      return ['revision'=>$o['revision'],'assetId'=>$o['assetId']];
    },3);
    // Old ciphertext must remain referenced until deletion is verified.
    if($old)\App\Jobs\PhotoAssetCleanupJob::dispatch($p->id,$old);
    return $this->sync->json($reply);
  }
}
