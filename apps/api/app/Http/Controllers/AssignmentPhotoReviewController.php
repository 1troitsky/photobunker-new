<?php
declare(strict_types=1);
namespace App\Http\Controllers;
use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
final class AssignmentPhotoReviewController extends Controller {
 public function __construct(private readonly PhotoSync $sync){}
 private function bound(Request $r,string $id):array{
  [$actor,$device]=$this->sync->actor($r);
  $photo=$this->sync->requirePhoto($id,$actor->id,true);
  $binding=DB::table('assignment_photo_bindings_v1')->where('photo_id',$id)->first();
  abort_unless($binding,404);
  return [$actor,$device,$binding];
 }
 public function show(Request $r,string $photoId){
  [$actor,$device,$binding]=$this->bound($r,$photoId);
  return $this->sync->json([
   'photoId'=>$photoId,'assignmentId'=>$binding->assignment_id,
   'state'=>$binding->review_state,'revision'=>(int)$binding->review_revision,
   'reviewEnvelope'=>$binding->review_cipher?json_decode($binding->review_cipher,true,16,JSON_THROW_ON_ERROR):null,
   'responseEnvelope'=>$binding->response_cipher?json_decode($binding->response_cipher,true,16,JSON_THROW_ON_ERROR):null,
  ]);
 }
 public function mutate(Request $r,string $photoId){
  $this->sync->origin($r);[$actor,$device,$binding]=$this->bound($r,$photoId);
  P::uuid($photoId);
  $payload=P::exact($r->json()->all(),['contract','signature']);
  abort_unless(is_string($payload['contract'])&&is_string($payload['signature'])
   &&strlen($payload['contract'])<=14000,422);
  try{$c=json_decode($payload['contract'],true,32,JSON_THROW_ON_ERROR);}
  catch(\Throwable){abort(422);}
  abort_unless(is_array($c),422);
  P::exact($c,['v','photoId','operationId','expectedRevision','action','state','envelope']);
  abort_unless($c['v']===1 && $c['photoId']===$photoId && is_string($c['operationId']),422);
  P::uuid($c['operationId']);
  abort_unless(is_int($c['expectedRevision'])&&$c['expectedRevision']>=1&&
   in_array($c['action'],['review','respond'],true),422);
  if($c['action']==='review'){
   abort_unless(in_array($c['state'],['accepted','correction','reshoot','rejected'],true),422);
  }else abort_unless($c['state']===null,422);
  $envelope=$c['envelope'];
  if($envelope!==null){
   abort_unless(is_array($envelope),422);
   P::exact($envelope,['v','accountId','photoId','operationId','revision','iv','wrappedDEK','ciphertext']);
   abort_unless($envelope['v']===1&&$envelope['accountId']===$actor->id&&
    $envelope['photoId']===$photoId&&$envelope['operationId']===$c['operationId']&&
    $envelope['revision']===$c['expectedRevision']+1 &&
    is_array($envelope['wrappedDEK']),422);
   P::exact($envelope['wrappedDEK'],['iv','ciphertext']);
   abort_unless(is_string($envelope['iv'])&&is_string($envelope['ciphertext'])
    &&strlen($envelope['ciphertext'])<=12000,422);
   P::b64($envelope['iv'],12);P::b64($envelope['wrappedDEK']['iv'],12);
   P::b64($envelope['wrappedDEK']['ciphertext']);
   abort_unless(preg_match('/^[A-Za-z0-9_-]+$/D',$envelope['ciphertext'])===1,422);
  }
  if($c['action']==='review'&&$c['state']!=='accepted')abort_unless($envelope!==null,422);
  if($c['action']==='respond')abort_unless($envelope!==null,422);
  abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$payload['contract'],422);
  abort_unless(P::verify($device->signing_spki,
   "photobunker.photo-review.v1\n".$payload['contract'],$payload['signature']),401);
  $hash=hash('sha256',$payload['contract']);
  $result=DB::transaction(function()use($c,$hash,$photoId,$actor){
   DB::table('identity_accounts')->where('id',$actor->id)->lockForUpdate()->first();
   // Revalidate under lock, including expiry; stale ACK must not resurrect a photo.
   $photo=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
   abort_unless($photo&&$photo->account_id===$actor->id,404);
   abort_if($photo->state!=='active'||$photo->expires_at<=PhotoSync::nowMs(),410);
   \App\Assignments\CaptureBinding::active($photo,$actor->id);
   $past=DB::table('assignment_review_operations_v1')->where('id',$c['operationId'])->first();
   if($past){
    abort_unless($past->photo_id===$photoId&&$past->actor_id===$actor->id&&
     hash_equals($past->contract_hash,$hash),409);
    return ['accepted'=>true,'revision'=>(int)$past->revision,'replayed'=>true];
   }
   $row=DB::table('assignment_photo_bindings_v1')->where('photo_id',$photoId)->lockForUpdate()->first();
   abort_unless($row&&$row->author_account_id===$actor->id,404);
   if((int)$row->review_revision!==$c['expectedRevision'])
    return ['accepted'=>false,'error'=>'review.conflict','currentRevision'=>(int)$row->review_revision];
   if($c['action']==='respond')abort_unless(in_array($row->review_state,['correction','reshoot'],true),422);
   $revision=$c['expectedRevision']+1;
   $update=['review_revision'=>$revision,'updated_at'=>now()];
   $serialized=$c['envelope']===null?null:
    json_encode($c['envelope'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
   if($c['action']==='review'){
    $update['review_state']=$c['state'];$update['review_cipher']=$serialized;
    $update['response_cipher']=null;$update['reviewed_at']=now();$update['responded_at']=null;
   }else{$update['response_cipher']=$serialized;$update['responded_at']=now();}
   DB::table('assignment_photo_bindings_v1')->where('photo_id',$photoId)->update($update);
   DB::table('assignment_review_operations_v1')->insert([
    'id'=>$c['operationId'],'photo_id'=>$photoId,'actor_id'=>$actor->id,
    'contract_hash'=>$hash,'revision'=>$revision,'accepted_at'=>now(),
   ]);
   return ['accepted'=>true,'revision'=>$revision];
  },3);
  return $this->sync->json($result,($result['accepted']??false)?200:409);
 }
}
