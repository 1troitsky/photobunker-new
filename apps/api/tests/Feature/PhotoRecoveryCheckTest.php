<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PhotoRecoveryCheckTest extends TestCase
{
    use RefreshDatabase;

    private function pair():array {
        $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $details=openssl_pkey_get_details($key);
        $body=preg_replace('/-----[^-]+-----|\s+/', '',$details['key']);
        return ['key'=>$key,'spki'=>P::encode(base64_decode($body))];
    }
    private function signature($key,string $message):string {
        openssl_sign($message,$der,$key,OPENSSL_ALGO_SHA256);
        $index=2;
        $parse=function() use(&$index,$der):string{
            if(ord($der[$index++])!==2)throw new \RuntimeException('bad DER');
            $length=ord($der[$index++]);$raw=substr($der,$index,$length);
            $index+=$length;
            return str_pad(ltrim($raw,"\0"),32,"\0",STR_PAD_LEFT);
        };
        return P::encode($parse().$parse());
    }
    private function prepare():array {
        $account=(string)Str::uuid();
        $origin=(string)Str::uuid();
        $verifier=(string)Str::uuid();
        $sourceKey=$this->pair();$verifyKey=$this->pair();
        $photoId=(string)Str::uuid();$assetId=(string)Str::uuid();
        $digest=hash('sha256','encrypted test file');
        $now=now();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),
            'prepare_hash'=>hash('sha256','reservation'),'status'=>'ready',
            'revision'=>1,'reserved_until'=>$now->copy()->addMinutes(15),
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        foreach([[$origin,$sourceKey],[$verifier,$verifyKey]] as [$device,$pair]){
            DB::table('identity_devices')->insert([
                'id'=>$device,'account_id'=>$account,'signing_spki'=>$pair['spki'],
                'created_at'=>$now,'updated_at'=>$now,
            ]);
        }
        DB::table('photo_records')->insert([
            'id'=>$photoId,'account_id'=>$account,'device_id'=>$origin,
            'operation_id'=>(string)Str::uuid(),'state'=>'active',
            'expires_at'=>(int)floor(microtime(true)*1000)+3600000,
            'contract_hash'=>hash('sha256','contract'),
            'contract_json'=>'{}','signature'=>'fixture','receipt'=>'{}',
            'created_at'=>$now,'updated_at'=>$now,
        ]);
        DB::table('photo_objects')->insert([
            'id'=>$assetId,'photo_id'=>$photoId,'kind'=>'master',
            'revision'=>1,'bytes'=>25,'sha256'=>$digest,
            'manifest_json'=>'{}','object_key'=>'g5/'.(string)Str::uuid(),
            'state'=>'active','created_at'=>$now,'updated_at'=>$now,
        ]);
        return compact('account','origin','verifier','photoId','assetId','digest','sourceKey','verifyKey');
    }
    private function input(array $f):array {
        $fields=[
            'photoId'=>$f['photoId'],'assetId'=>$f['assetId'],
            'originDeviceId'=>$f['origin'],'verifiedDeviceId'=>$f['verifier'],
            'operationId'=>(string)Str::uuid(),'decryption'=>'aead-verified',
            'cipherSha256'=>$f['digest'],
        ];
        return [...$fields,'signature'=>$this->signature($f['verifyKey']['key'],
            "photobunker.recovery-check.v1\n".P::canonical($fields))];
    }
    private function put(array $input) {
        return $this->withHeader('Origin','https://localhost')->putJson(
            '/photos/v1/'.$input['photoId'].'/recovery-checks/'.$input['assetId'],$input);
    }
    private function session(array $f):void{
        $this->withSession([
            'identity_account'=>$f['account'],'identity_device'=>$f['verifier'],
            'identity_issued'=>time(),
        ]);
    }
    public function test_independent_device_claim_is_signed_immutable_and_replayable():void {
        $fixture=$this->prepare();$this->session($fixture);
        $input=$this->input($fixture);
        $first=$this->put($input)->assertOk()->assertJsonPath('state','device-attested')
            ->assertJsonPath('decryption','aead-verified')->json();
        $this->assertSame($fixture['digest'],$first['cipherSha256']);
        $this->assertDatabaseCount('photo_recovery_checks',1);
        $again=$this->put($input)->assertOk()->json();
        $this->assertSame($first,$again);
        $listed=$this->getJson('/photos/v1/'.$fixture['photoId'].'/recovery-checks')
            ->assertOk()->json('checks');
        $this->assertCount(1,$listed);
        $this->assertSame($first,$listed[0]);
        $next=$this->input($fixture);
        $this->put($next)->assertStatus(409);
    }
    public function test_self_attestation_wrong_digest_and_untrusted_signature_are_denied():void {
        $fixture=$this->prepare();$this->session($fixture);
        $input=$this->input($fixture);
        $this->put([...$input,'originDeviceId'=>$fixture['verifier']])->assertStatus(422);
        $this->put([...$input,'cipherSha256'=>str_repeat('a',64)])->assertUnauthorized();
        $wrong=$this->input($fixture);
        $wrong['signature']=$this->signature($fixture['sourceKey']['key'],
            "photobunker.recovery-check.v1\n".P::canonical(array_diff_key(
                $wrong,['signature'=>true])));
        $this->put($wrong)->assertUnauthorized();
        $this->assertDatabaseCount('photo_recovery_checks',0);
    }
    public function test_valid_signature_with_mismatched_active_object_digest_fails_closed():void {
        $fixture=$this->prepare();$this->session($fixture);
        $fields=$this->input($fixture);
        $fields['cipherSha256']=str_repeat('0',64);
        unset($fields['signature']);
        $input=[...$fields,'signature'=>$this->signature($fixture['verifyKey']['key'],
            "photobunker.recovery-check.v1\n".P::canonical($fields))];
        $this->put($input)->assertStatus(409);
        $this->assertDatabaseCount('photo_recovery_checks',0);
    }
    public function test_first_claim_requires_live_session_and_same_origin():void {
        $fixture=$this->prepare();$input=$this->input($fixture);
        $this->put($input)->assertUnauthorized();
        $this->session($fixture);
        $this->withHeader('Origin','https://evil.example')
            ->putJson('/photos/v1/'.$input['photoId'].'/recovery-checks/'.$input['assetId'],
            $input)->assertForbidden();
        $this->assertDatabaseCount('photo_recovery_checks',0);
    }
}
