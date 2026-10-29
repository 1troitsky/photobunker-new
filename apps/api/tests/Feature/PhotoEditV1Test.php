<?php
declare(strict_types=1);
namespace Tests\Feature;
use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;
final class PhotoEditV1Test extends TestCase{
 use RefreshDatabase;
 private $key;
 private string $account;
 private string $device;
 private string $photo;
 private string $initial;
 private int $expires;
 protected function setUp():void{
  parent::setUp();
  Storage::fake(config('photo_sync.disk'));
  $this->key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
  $pem=openssl_pkey_get_details($this->key)['key'];
  $this->account=(string)Str::uuid();$this->device=(string)Str::uuid();
  $this->photo=(string)Str::uuid();$this->initial=(string)Str::uuid();
  $this->expires=now()->addDay()->getTimestampMs();
  DB::table('identity_accounts')->insert([
   'id'=>$this->account,'operation_id'=>(string)Str::uuid(),'prepare_hash'=>str_repeat('a',64),
   'status'=>'ready','reserved_until'=>now()->addDay(),'created_at'=>now(),'updated_at'=>now(),
  ]);
  DB::table('identity_devices')->insert([
   'id'=>$this->device,'account_id'=>$this->account,
   'signing_spki'=>P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pem))),
   'created_at'=>now(),'updated_at'=>now(),
  ]);
  $this->withSession(['identity_account'=>$this->account,'identity_device'=>$this->device,
    'identity_issued'=>time()])->withHeader('Origin','https://localhost');
 }
 private function photo(string $kind):void{
  $contract=json_encode(['version'=>1,'assets'=>[['kind'=>$kind]]],JSON_THROW_ON_ERROR);
  DB::table('photo_records')->insert([
   'id'=>$this->photo,'account_id'=>$this->account,'device_id'=>$this->device,
   'operation_id'=>(string)Str::uuid(),'state'=>'active','expires_at'=>$this->expires,
   'contract_hash'=>str_repeat('b',64),'contract_json'=>$contract,'signature'=>'test',
   'metadata_asset_id'=>(string)Str::uuid(),'created_at'=>now(),'updated_at'=>now(),
  ]);
  DB::table('photo_objects')->insert([
   'id'=>$this->initial,'photo_id'=>$this->photo,'kind'=>$kind,'revision'=>1,
   'bytes'=>100,'sha256'=>str_repeat('a',64),'manifest_json'=>'{}',
   'object_key'=>'cipher/v1/'.$this->account.'/'.$this->photo.'/'.$this->initial,
   'state'=>'active','created_at'=>now(),'updated_at'=>now(),
  ]);
 }
 private function signature(string $message):string{
  openssl_sign($message,$der,$this->key,OPENSSL_ALGO_SHA256);
  $cursor=2;$parts=[];
  foreach([1,2] as $_){
   if(ord($der[$cursor++])!==2)throw new \RuntimeException('bad DER');
   $length=ord($der[$cursor++]);$part=substr($der,$cursor,$length);$cursor+=$length;
   $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
  }
  return P::encode(implode('',$parts));
 }
 private function request(int $mode=3,int $expected=0,?string $operation=null,?string $assetId=null):array{
  $operation??=(string)Str::uuid();$assetId??=(string)Str::uuid();
  $kind=$mode===2?'edit':'master';$revision=$expected+1;$bytes=random_bytes(256);
  $manifest=[
   'version'=>1,'algorithm'=>'AES-256-GCM','chunkBytes'=>262144,
   'accountId'=>$this->account,'photoId'=>$this->photo,'assetId'=>$assetId,'kind'=>$kind,
   'revision'=>$revision,'expiresAt'=>$this->expires,'plainBytes'=>240,'cipherBytes'=>256,
   'frames'=>[['index'=>0,'offset'=>0,'bytes'=>256,'plainBytes'=>240,
    'iv'=>P::encode(random_bytes(12)),'digest'=>hash('sha256',$bytes)]],
   'cipherDigest'=>str_repeat('c',64),'wrappedDEK'=>[
    'iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(48))],
  ];
  $statement=['v'=>1,'photoId'=>$this->photo,'operationId'=>$operation,
   'expectedRevision'=>$expected,'mode'=>$mode,'asset'=>[
    'assetId'=>$assetId,'kind'=>$kind,'revision'=>$revision,'bytes'=>256,
    'sha256'=>hash('sha256',$bytes),'manifest'=>$manifest],
  ];
  $json=json_encode($statement,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
  return['body'=>['contract'=>$json,'signature'=>$this->signature("photobunker.photo-edit.v1\n".$json)],
   'bytes'=>$bytes,'assetId'=>$assetId,'operationId'=>$operation];
 }
 private function upload(array $fixture):void{
  $bytes=$fixture['bytes'];
  $this->call('PUT','/photos/v1/'.$this->photo.'/edits/'.$fixture['assetId'],
   [],[],[],['HTTP_ORIGIN'=>'https://localhost','CONTENT_LENGTH'=>(string)strlen($bytes),
   'CONTENT_TYPE'=>'application/octet-stream'],$bytes)->assertOk();
 }
 public function test_mode3_signed_cas_replay_and_expiry_never_prolonged():void{
  $this->photo('master');$f=$this->request();
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$f['body'])
   ->assertOk()->assertJsonPath('state','pending');
  $this->upload($f);
  $uri='/photos/v1/'.$this->photo.'/edits/finalize';
  $this->postJson($uri,$f['body'])->assertOk()->assertJsonPath('revision',1);
  $this->postJson($uri,$f['body'])->assertOk()->assertJsonPath('revision',1);
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$f['body'])
   ->assertOk()->assertJsonPath('state','active');
  $this->assertDatabaseHas('photo_records',['id'=>$this->photo,
   'edit_revision'=>1,'edit_asset_id'=>$f['assetId'],'expires_at'=>$this->expires]);
  $this->getJson('/photos/v1/'.$this->photo.'/objects/'.$this->initial)->assertNotFound();
  $this->getJson('/photos/v1/'.$this->photo.'/objects/'.$f['assetId'])->assertOk();
  $stale=$this->request(3,0);
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$stale['body'])->assertConflict();
 }
 public function test_mode2_retains_original_but_old_edits_are_not_exposed():void{
  $this->photo('original');$f=$this->request(2);
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$f['body'])->assertOk();
  $this->upload($f);
  $this->postJson('/photos/v1/'.$this->photo.'/edits/finalize',$f['body'])->assertOk();
  $this->assertDatabaseHas('photo_objects',['id'=>$this->initial,'kind'=>'original','state'=>'active']);
  $this->assertDatabaseHas('photo_objects',['id'=>$f['assetId'],'kind'=>'edit','state'=>'active']);
 }
 public function test_wrong_mode_signature_and_expired_original_fail_closed():void{
  $this->photo('master');
  $mode2=$this->request(2);
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$mode2['body'])->assertForbidden();
  $broken=$this->request();$broken['body']['signature']=P::encode(random_bytes(64));
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$broken['body'])->assertUnauthorized();
  DB::table('photo_records')->where('id',$this->photo)
   ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
  $this->postJson('/photos/v1/'.$this->photo.'/edits/reserve',$this->request()['body'])->assertGone();
 }
}
