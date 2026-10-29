<?php
declare(strict_types=1);
namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AssignmentGrantV1Test extends TestCase {
    use RefreshDatabase;
    private array $accounts=[];
    private array $devices=[];
    private array $signers=[];
    private string $actor='owner';
    private string $assignment;

    protected function setUp():void {
        parent::setUp();
        foreach(['owner','guest','outsider'] as $name)$this->makeActor($name);
        $this->assignment=(string)Str::uuid();
        DB::table('assignments')->insert([
            'id'=>$this->assignment,'account_id'=>$this->accounts['owner'],
            'status'=>'in_progress','revision'=>2,'policy_revision'=>1,
            'mode'=>3,'retention_days'=>1,'cipher_envelope'=>'{}',
            'last_operation_id'=>(string)Str::uuid(),'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->be('owner');
    }
    private function makeActor(string $name):void {
        $signer=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $public=openssl_pkey_get_details($signer)['key'];
        $account=(string)Str::uuid();$device=(string)Str::uuid();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>str_repeat('a',64),'status'=>'ready',
            'reserved_until'=>now()->addDay(),'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,
            'signing_spki'=>P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$public))),
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->accounts[$name]=$account;$this->devices[$name]=$device;$this->signers[$name]=$signer;
    }
    private function be(string $name):void {
        $this->actor=$name;
        $this->withSession([
            'identity_account'=>$this->accounts[$name],
            'identity_device'=>$this->devices[$name],'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }
    private function sign(string $message):string {
        openssl_sign($message,$der,$this->signers[$this->actor],OPENSSL_ALGO_SHA256);
        $offset=2;$parts=[];
        for($i=0;$i<2;$i++){
            if(ord($der[$offset++])!==2)throw new \RuntimeException('bad DER');
            $length=ord($der[$offset++]);
            $chunk=substr($der,$offset,$length);$offset+=$length;
            $parts[]=str_pad(ltrim($chunk,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }
    private function acceptedContact():void {
        [$left,$right]=strcmp($this->accounts['owner'],$this->accounts['guest'])<0
            ?[$this->accounts['owner'],$this->accounts['guest']]
            :[$this->accounts['guest'],$this->accounts['owner']];
        DB::table('contact_links_v1')->insert([
            'left_account_id'=>$left,'right_account_id'=>$right,
            'requester_id'=>$this->accounts['owner'],'state'=>'accepted',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
    }
    private function action(string $kind,string $grant,int $generation=0,
        ?string $op=null,?int $expiry=null):array {
        $operation=$op??(string)Str::uuid();$invite=$kind==='invite';
        $c=['v'=>1,'opId'=>$operation,'kind'=>$kind,
            'grantId'=>$grant,'assignmentId'=>$this->assignment,
            'targetId'=>$invite?$this->accounts['guest']:null,
            'role'=>$invite?'contributor':null,'expectedGeneration'=>$generation,
            'expiresAt'=>$invite?($expiry??now()->getTimestampMs()+3600000):null,
            'codeHash'=>$invite?str_repeat('c',64):null,
            'sealedKey'=>$invite?['v'=>1,'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48))]:null];
        $raw=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$raw,'signature'=>$this->sign(
            "photobunker.assignment-grant.v1\n".$raw)];
    }
    private function send(array $body) {
        $id=json_decode($body['contract'],true,24,JSON_THROW_ON_ERROR)['opId'];
        return $this->putJson('/assignments/v1/grants/operations/'.$id,$body);
    }
    public function test_only_owner_can_invite_accepted_contact_and_recipient_must_accept():void {
        $grant=(string)Str::uuid();
        $invite=$this->action('invite',$grant);
        $this->send($invite)->assertForbidden();
        $this->acceptedContact();
        $this->send($invite)->assertOk()->assertJsonPath('state','pending');
        $this->send($invite)->assertOk()->assertJsonPath('state','pending');
        $this->assertSame(1,DB::table('assignment_grants_v1')->count());
        $this->getJson('/assignments/v1/grants')->assertOk()
            ->assertJsonPath('grants.0.sealedKey',null);
        $this->be('outsider');
        $this->getJson('/assignments/v1/grants')->assertOk()->assertJsonCount(0,'grants');
        $this->send($this->action('accept',$grant,1))->assertNotFound();
        $this->be('guest');
        $this->getJson('/assignments/v1/grants')->assertOk()
            ->assertJsonPath('grants.0.codeHash',str_repeat('c',64))
            ->assertJsonPath('grants.0.state','pending');
        $accept=$this->action('accept',$grant,1);
        $this->send($accept)->assertOk()->assertJsonPath('generation',2);
        $this->send($accept)->assertOk()->assertJsonPath('generation',2);
        $this->send($this->action('accept',$grant,1))->assertStatus(409);
        $this->be('owner');
        $this->send($this->action('revoke',$grant,2))->assertOk()->assertJsonPath('state','revoked');
        $this->be('guest');
        $this->getJson('/assignments/v1/grants')->assertOk()->assertJsonCount(0,'grants');
        $this->assertDatabaseHas('assignment_grants_v1',['id'=>$grant,'generation'=>3,'state'=>'revoked']);
    }
    public function test_no_duplicate_active_grants_block_or_expiry_bypass():void {
        $this->acceptedContact();
        $grant=(string)Str::uuid();
        $this->send($this->action('invite',$grant))->assertOk();
        $this->send($this->action('invite',(string)Str::uuid()))->assertStatus(409);
        DB::table('contact_blocks_v1')->insert([
            'account_id'=>$this->accounts['owner'],'blocked_account_id'=>$this->accounts['guest'],
            'created_at'=>now(),
        ]);
        $this->be('guest');
        $this->getJson('/assignments/v1/grants')->assertOk()->assertJsonCount(0,'grants');
        $this->send($this->action('accept',$grant,1))->assertForbidden();
        $this->be('owner');
        DB::table('contact_blocks_v1')->delete();
        DB::table('assignment_grants_v1')->where('id',$grant)
            ->update(['invite_expires_at'=>now()->getTimestampMs()-1]);
        $this->be('guest');
        $this->send($this->action('accept',$grant,1))->assertStatus(409);
        $this->be('owner');
        $this->send($this->action('invite',(string)Str::uuid()))->assertOk();
        $this->send($this->action('invite',(string)Str::uuid(),0,null,
            now()->getTimestampMs()-1))->assertStatus(422);
    }
    public function test_signed_contract_rejects_tamper_and_invite_does_not_enable_photo_reads():void {
        $this->acceptedContact();
        $grant=(string)Str::uuid();$invitation=$this->action('invite',$grant);
        $invalid=$invitation;$invalid['signature']=P::encode(random_bytes(64));
        $this->send($invalid)->assertUnauthorized();
        $bad=$invitation;$data=json_decode($bad['contract'],true);
        $data['role']='owner';$bad['contract']=json_encode($data,JSON_UNESCAPED_SLASHES);
        $this->send($bad)->assertStatus(422);
        $this->send($invitation)->assertOk();
        $photo=(string)Str::uuid();
        DB::table('photo_records')->insert([
            'id'=>$photo,'account_id'=>$this->accounts['owner'],
            'device_id'=>$this->devices['owner'],'operation_id'=>(string)Str::uuid(),
            'state'=>'active','expires_at'=>now()->getTimestampMs()+3600000,
            'contract_hash'=>str_repeat('d',64),'contract_json'=>'{}',
            'signature'=>P::encode(random_bytes(64)),'receipt'=>'{}',
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        $this->be('guest');
        $this->send($this->action('accept',$grant,1))->assertOk();
        $this->getJson('/photos/v1/'.$photo.'/manifests')->assertNotFound();
        $this->getJson('/photos/v1/'.$photo.'/objects/'.Str::uuid())->assertNotFound();
    }

    /** Creates a thumbnail-only frozen capture and server manifest for the same owner. */
    private function thumbnailFixture():array{
        $photo=(string)Str::uuid();$asset=(string)Str::uuid();
        $expire=now()->getTimestampMs()+3600000;$digest=str_repeat('e',64);
        DB::table('photo_records')->insert([
            'id'=>$photo,'account_id'=>$this->accounts['owner'],
            'device_id'=>$this->devices['owner'],'operation_id'=>(string)Str::uuid(),
            'state'=>'active','expires_at'=>$expire,'contract_hash'=>str_repeat('f',64),
            'contract_json'=>'{}','signature'=>P::encode(random_bytes(64)),
            'receipt'=>'{}','created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('assignment_photo_bindings_v1')->insert([
            'photo_id'=>$photo,'assignment_id'=>$this->assignment,
            'author_account_id'=>$this->accounts['owner'],'assignment_revision'=>2,
            'policy_revision'=>1,'mode'=>3,'retention_days'=>1,
            'captured_at'=>$expire-86400000,'expires_at'=>$expire,
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('photo_objects')->insert([
            'id'=>$asset,'photo_id'=>$photo,'kind'=>'thumbnail','revision'=>1,
            'bytes'=>48,'sha256'=>str_repeat('a',64),'manifest_json'=>json_encode([
                'version'=>1,'accountId'=>$this->accounts['owner'],'photoId'=>$photo,
                'assetId'=>$asset,'kind'=>'thumbnail','revision'=>1,'expiresAt'=>$expire,
                'cipherDigest'=>$digest,
            ],JSON_UNESCAPED_SLASHES),'object_key'=>'cipher/v1/'.$this->accounts['owner'].'/'.$photo.'/'.$asset,
            'state'=>'active','created_at'=>now(),'updated_at'=>now(),
        ]);
        return [$photo,$asset,$expire,$digest];
    }
    private function shareStatement(string $grant,string $photo,string $asset,int $expiry,
        string $digest,int $generation=2):array{
        $owner=$this->accounts['owner'];$recipient=$this->accounts['guest'];
        $context=['grantId'=>$grant,'generation'=>$generation,'assignmentId'=>$this->assignment,
            'ownerAccountId'=>$owner,'recipientAccountId'=>$recipient,'photoId'=>$photo,
            'assetId'=>$asset,'kind'=>'thumbnail','revision'=>1,'expiresAt'=>$expiry,
            'cipherDigest'=>$digest];
        $c=['v'=>1,'operationId'=>(string)Str::uuid(),'grantId'=>$grant,'generation'=>$generation,
            'assignmentId'=>$this->assignment,'ownerAccountId'=>$owner,'recipientAccountId'=>$recipient,
            'photoId'=>$photo,'assetId'=>$asset,'kind'=>'thumbnail','assetRevision'=>1,
            'expiresAt'=>$expiry,'cipherDigest'=>$digest,
            'envelope'=>['v'=>1,'context'=>$context,'iv'=>P::encode(random_bytes(12)),
                'ciphertext'=>P::encode(random_bytes(48))]];
        $raw=json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$raw,
            'signature'=>$this->sign("photobunker.photo-recipient.v1\n".$raw)];
    }
    public function test_recipient_thumbnail_read_requires_signed_current_grant_and_feature_gate():void{
        $this->acceptedContact();$grant=(string)Str::uuid();
        $this->send($this->action('invite',$grant))->assertOk();
        $this->be('guest');
        $this->send($this->action('accept',$grant,1))->assertOk();
        $this->be('owner');[$photo,$asset,$expiry,$digest]=$this->thumbnailFixture();
        $route="/photos/v1/shared/grants/$grant/photos/$photo/assets/$asset";
        $publish=$this->shareStatement($grant,$photo,$asset,$expiry,$digest);
        $this->putJson($route,$publish)->assertOk()->assertJsonPath('accepted',true);
        $this->putJson($route,$publish)->assertOk()->assertJsonPath('replayed',true);
        $this->assertSame(1,DB::table('photo_recipient_keys_v1')->count());
        $this->be('guest');
        // Feature remains disabled unless security verification explicitly enables it.
        $this->getJson($route)->assertNotFound();
        config()->set('photo_sync.recipient_thumbnail_reads_enabled',true);
        $this->getJson($route)->assertOk()->assertJsonPath('assetId',$asset)
            ->assertJsonPath('manifest.cipherDigest',$digest);
        // The original owner's PhotoSync API never grants recipient access.
        $this->getJson("/photos/v1/$photo/manifests")->assertNotFound();
        // Device retirement must invalidate its published signer as well.
        DB::table('identity_devices')->where('id',$this->devices['owner'])
            ->update(['revoked_at'=>now()]);
        $this->getJson($route)->assertNotFound();
        DB::table('identity_devices')->where('id',$this->devices['owner'])
            ->update(['revoked_at'=>null]);
        $this->be('owner');
        $this->send($this->action('revoke',$grant,2))->assertOk();
        $this->be('guest');
        $this->getJson($route)->assertNotFound();
    }
    public function test_thumbnail_share_rejects_wrong_digest_wrong_actor_block_and_original_kind():void{
        $this->acceptedContact();$grant=(string)Str::uuid();
        $this->send($this->action('invite',$grant))->assertOk();
        $this->be('guest');$this->send($this->action('accept',$grant,1))->assertOk();
        $this->be('owner');[$photo,$asset,$expiry,$digest]=$this->thumbnailFixture();
        $route="/photos/v1/shared/grants/$grant/photos/$photo/assets/$asset";
        $bad=$this->shareStatement($grant,$photo,$asset,$expiry,str_repeat('b',64));
        $this->putJson($route,$bad)->assertNotFound();
        $statement=$this->shareStatement($grant,$photo,$asset,$expiry,$digest);
        $other=$statement;$other['signature']=P::encode(random_bytes(64));
        $this->putJson($route,$other)->assertUnauthorized();
        $payload=json_decode($statement['contract'],true);$payload['kind']='original';
        $altered=$statement;
        $altered['contract']=json_encode($payload,JSON_UNESCAPED_SLASHES);
        $this->putJson($route,$altered)->assertStatus(422);
        DB::table('contact_blocks_v1')->insert([
            'account_id'=>$this->accounts['owner'],'blocked_account_id'=>$this->accounts['guest'],
            'created_at'=>now(),
        ]);
        $this->putJson($route,$statement)->assertNotFound();
        DB::table('contact_blocks_v1')->delete();
        $this->be('guest');
        $this->putJson($route,$statement)->assertUnauthorized();
        $this->be('owner');
        $this->putJson($route,$statement)->assertOk();
        config()->set('photo_sync.recipient_thumbnail_reads_enabled',true);
        $this->be('outsider');$this->getJson($route)->assertNotFound();
        $this->be('guest');$this->getJson($route)->assertOk();
        DB::table('photo_records')->where('id',$photo)->update(['expires_at'=>now()->getTimestampMs()-1]);
        $this->getJson($route)->assertNotFound();
    }


    public function test_recipient_list_is_acl_scoped_paginated_and_disabled_by_default():void{
        $this->acceptedContact();$grant=(string)Str::uuid();
        $this->send($this->action('invite',$grant))->assertOk();
        $this->be('guest');$this->send($this->action('accept',$grant,1))->assertOk();
        $this->be('owner');
        [$photo,$asset,$expiry,$digest]=$this->thumbnailFixture();
        $path="/photos/v1/shared/grants/$grant/photos/$photo/assets/$asset";
        $this->putJson($path,$this->shareStatement($grant,$photo,$asset,$expiry,$digest))
            ->assertOk();
        $list="/photos/v1/shared/grants/$grant/photos";
        $this->be('guest');
        $this->getJson($list)->assertNotFound();
        config()->set('photo_sync.recipient_thumbnail_reads_enabled',true);
        $this->getJson($list)->assertOk()->assertJsonCount(1,'photos')
            ->assertJsonPath('photos.0.photoId',$photo)
            ->assertJsonPath('photos.0.assetId',$asset)
            ->assertJsonPath('nextCursor',null);
        // A raw photo ID is not a cursor and must be rejected.
        $this->getJson($list.'?after='.$photo.'&limit=1')->assertUnprocessable();
        // A second authorized photo yields an encrypted, account-bound cursor.
        $this->be('owner');
        [$second,$secondAsset,$secondExpiry,$secondDigest]=$this->thumbnailFixture();
        $this->putJson("/photos/v1/shared/grants/$grant/photos/$second/assets/$secondAsset",
            $this->shareStatement($grant,$second,$secondAsset,$secondExpiry,$secondDigest))
            ->assertOk();
        $this->be('guest');
        $first=$this->getJson($list.'?limit=1')->assertOk()
            ->assertJsonCount(1,'photos');
        $token=$first->json('nextCursor');
        $this->assertIsString($token);
        $this->assertStringNotContainsString($photo,$token);
        $this->assertStringNotContainsString($second,$token);
        $this->getJson($list.'?after='.$token.'&limit=1')->assertOk()
            ->assertJsonCount(1,'photos')->assertJsonPath('nextCursor',null);
        $corrupted=substr_replace($token,$token[5]==='A'?'B':'A',5,1);
        $this->getJson($list.'?after='.$corrupted.'&limit=1')->assertUnprocessable();

        $this->getJson($list.'?after=invalid&limit=1')->assertUnprocessable();
        $this->getJson($list.'?after='.$photo.'&limit=99')->assertUnprocessable();
        $this->be('outsider');$this->getJson($list)->assertNotFound();
        $this->be('guest');
        DB::table('contact_blocks_v1')->insert([
            'account_id'=>$this->accounts['guest'],
            'blocked_account_id'=>$this->accounts['owner'],'created_at'=>now(),
        ]);
        $this->getJson($list)->assertOk()->assertJsonCount(0,'photos');
        DB::table('contact_blocks_v1')->delete();
        DB::table('assignments')->where('id',$this->assignment)->update(['status'=>'completed']);
        $this->getJson($list)->assertOk()->assertJsonCount(0,'photos');
        DB::table('assignments')->where('id',$this->assignment)->update(['status'=>'in_progress']);
        $this->be('owner');$this->send($this->action('revoke',$grant,2))->assertOk();
        $this->be('guest');$this->getJson($list)->assertNotFound();
    }

}
