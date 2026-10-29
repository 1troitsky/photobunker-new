<?php
declare(strict_types=1);
namespace Tests\Feature;
use App\Assignments\CaptureBinding;
use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AssignmentCaptureV1Test extends TestCase {
 use RefreshDatabase;
 private string $account;
 private string $device;
 private string $assignment;
 private string $photo;
 private $signer;
 protected function setUp():void{
  parent::setUp();
  $this->account=(string)Str::uuid();$this->device=(string)Str::uuid();
  $this->assignment=(string)Str::uuid();$this->photo=(string)Str::uuid();
  $this->signer=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
  $pem=openssl_pkey_get_details($this->signer)['key'];
  DB::table('identity_accounts')->insert([
   'id'=>$this->account,'operation_id'=>(string)Str::uuid(),
   'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
   'reserved_until'=>now()->addDay(),'created_at'=>now(),'updated_at'=>now(),
  ]);
  DB::table('identity_devices')->insert([
   'id'=>$this->device,'account_id'=>$this->account,
   'signing_spki'=>P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pem))),
   'created_at'=>now(),'updated_at'=>now(),
  ]);
  DB::table('assignments')->insert([
   'id'=>$this->assignment,'account_id'=>$this->account,'status'=>'in_progress',
   'revision'=>2,'policy_revision'=>1,'mode'=>3,'retention_days'=>3,
   'cipher_envelope'=>'{}','last_operation_id'=>(string)Str::uuid(),
   'created_at'=>now(),'updated_at'=>now(),
  ]);
  DB::table('assignment_capture_policies_v1')->insert([
   'assignment_id'=>$this->assignment,'assignment_revision'=>1,
   'policy_revision'=>1,'mode'=>3,'retention_days'=>3,'effective_at'=>now(),
  ]);
  DB::table('assignment_history')->insert([
   'operation_id'=>(string)Str::uuid(),'assignment_id'=>$this->assignment,
   'account_id'=>$this->account,'action'=>'transition','from_status'=>'waiting',
   'to_status'=>'in_progress','revision'=>2,'policy_revision'=>1,
   'cipher_envelope'=>'{}','accepted_at'=>now(),
  ]);
  $this->withSession(['identity_account'=>$this->account,'identity_device'=>$this->device,
   'identity_issued'=>time()])->withHeader('Origin','https://localhost');
 }
 private function snap():array{
  return ['assignmentId'=>$this->assignment,'assignmentRevision'=>2,'policyRevision'=>1,
   'mode'=>3,'retentionDays'=>3,'capturedAt'=>now()->getTimestampMs()];
 }
 private function sign(string $value):string{
  openssl_sign($value,$der,$this->signer,OPENSSL_ALGO_SHA256);
  $cursor=2;$parts=[];
  for($n=0;$n<2;$n++){
   if(ord($der[$cursor++])!==2)throw new \RuntimeException('bad DER');
   $length=ord($der[$cursor++]);$part=substr($der,$cursor,$length);$cursor+=$length;
   $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
  }
  return P::encode(implode('',$parts));
 }
 private function link():void{
  DB::table('photo_records')->insert([
   'id'=>$this->photo,'account_id'=>$this->account,'device_id'=>$this->device,
   'operation_id'=>(string)Str::uuid(),'state'=>'active','expires_at'=>now()->addDays(3)->getTimestampMs(),
   'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}','signature'=>'test',
   'metadata_asset_id'=>(string)Str::uuid(),'created_at'=>now(),'updated_at'=>now(),
  ]);
  CaptureBinding::record($this->photo,$this->account,$this->snap(),now()->addDays(3)->getTimestampMs());
 }
 private function command(string $action,?string $state,int $revision,?string $id=null):array{
  $op=$id??(string)Str::uuid();
  $envelope=[
   'v'=>1,'accountId'=>$this->account,'photoId'=>$this->photo,'operationId'=>$op,
   'revision'=>$revision+1,'iv'=>P::encode(random_bytes(12)),
   'wrappedDEK'=>['iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(48))],
   'ciphertext'=>P::encode(random_bytes(100)),
  ];
  $data=['v'=>1,'photoId'=>$this->photo,'operationId'=>$op,'expectedRevision'=>$revision,
   'action'=>$action,'state'=>$state,'envelope'=>$envelope];
  $text=json_encode($data,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
  return['contract'=>$text,'signature'=>$this->sign("photobunker.photo-review.v1\n".$text)];
 }
 public function test_signed_snapshot_uses_authoritative_policy_and_does_not_allow_forged_mode():void{
  $good=$this->snap();$expiry=$good['capturedAt']+3*86400000;
  $this->assertSame($good,CaptureBinding::validate($good,$this->account,$expiry));
  $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
  CaptureBinding::validate([...$good,'mode'=>2],$this->account,$expiry);
 }
 public function test_photo_review_is_idempotent_revisioned_and_separate_from_assignment_state():void{
  $this->link();
  $this->getJson('/photos/v1/'.$this->photo.'/review')->assertOk()
   ->assertJsonPath('state','pending')->assertJsonPath('revision',1);
  $first=$this->command('review','correction',1);
  $this->putJson('/photos/v1/'.$this->photo.'/review',$first)->assertOk()->assertJsonPath('revision',2);
  $this->putJson('/photos/v1/'.$this->photo.'/review',$first)->assertOk()->assertJsonPath('replayed',true);
  $this->assertDatabaseHas('assignment_photo_bindings_v1',['photo_id'=>$this->photo,
   'review_state'=>'correction','review_revision'=>2]);
  $this->assertDatabaseHas('assignments',['id'=>$this->assignment,'status'=>'in_progress','revision'=>2]);
  $stale=$this->command('review','rejected',1);
  $this->putJson('/photos/v1/'.$this->photo.'/review',$stale)->assertConflict()
   ->assertJsonPath('currentRevision',2);
  $reply=$this->command('respond',null,2);
  $this->putJson('/photos/v1/'.$this->photo.'/review',$reply)->assertOk()->assertJsonPath('revision',3);
  $this->assertDatabaseCount('assignment_review_operations_v1',2);
 }
 public function test_revoked_assignment_or_expired_photo_does_not_reopen_on_replay():void{
  $this->link();$request=$this->command('review','accepted',1);
  $this->putJson('/photos/v1/'.$this->photo.'/review',$request)->assertOk();
  DB::table('photo_records')->where('id',$this->photo)
   ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
  $this->putJson('/photos/v1/'.$this->photo.'/review',$request)->assertGone();
  $this->getJson('/photos/v1/'.$this->photo.'/review')->assertGone();
 }
 public function test_unrelated_authenticated_account_cannot_read_assignment_review():void{
  $this->link();
  $this->withSession(['identity_account'=>(string)Str::uuid(),'identity_device'=>$this->device,
   'identity_issued'=>time()])
   ->getJson('/photos/v1/'.$this->photo.'/review')->assertUnauthorized();
 }
}
