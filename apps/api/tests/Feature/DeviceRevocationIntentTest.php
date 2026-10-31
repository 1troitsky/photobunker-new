<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeviceRevocationIntentTest extends TestCase
{
    use RefreshDatabase;

    private function signer(): array {
        $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $detail=openssl_pkey_get_details($key);
        $encoded=preg_replace('/-----[^-]+-----|\s+/', '', $detail['key']);
        return ['key'=>$key,'spki'=>P::encode(base64_decode($encoded))];
    }
    private function signature($key,string $message): string {
        openssl_sign($message,$der,$key,OPENSSL_ALGO_SHA256);
        $i=2;
        $parse=function()use(&$i,$der):string{
            if(ord($der[$i++])!==2)throw new \RuntimeException('unexpected DER');
            $length=ord($der[$i++]);
            $bytes=substr($der,$i,$length);$i+=$length;
            return str_pad(ltrim($bytes,"\0"),32,"\0",STR_PAD_LEFT);
        };
        return P::encode($parse().$parse());
    }
    private function fixture(): array {
        $account=(string) Str::uuid();
        $device=(string) Str::uuid();
        $key=$this->signer();
        DB::table('identity_accounts')->insert([
            'id'=>$account,'operation_id'=>(string)Str::uuid(),'prepare_hash'=>hash('sha256','test'),
            'status'=>'ready','revision'=>1,'created_at'=>now(),'updated_at'=>now(),
        ]);
        DB::table('identity_devices')->insert([
            'id'=>$device,'account_id'=>$account,'signing_spki'=>$key['spki'],
            'created_at'=>now(),'updated_at'=>now(),
        ]);
        return [$account,$device,$key];
    }
    private function envelope(string $account,string $device,$key,string $kind='emergency'): array {
        $operationId=(string) Str::uuid();
        $payload=['accountId'=>$account,'deviceId'=>$device,'intent'=>$kind,'operationId'=>$operationId];
        $message="photobunker.device-revocation.v1\n".P::canonical($payload);
        return [...$payload,'signature'=>$this->signature($key,$message)];
    }
    private function send(array $payload) {
        return $this->withHeader('Origin','https://localhost')->putJson(
            '/identity/v2/device-revocations/'.$payload['operationId'],$payload);
    }
    public function test_revoke_once_replay_receipt_after_session_expiration_and_reject_conflicting_intent():void {
        [$account,$device,$key]=$this->fixture();
        $body=$this->envelope($account,$device,$key['key']);
        $this->withSession(['identity_account'=>$account,'identity_device'=>$device,
            'identity_issued'=>time()]);
        $first=$this->send($body)->assertOk()->assertJsonPath('state','revoked')
            ->assertJsonPath('intent','emergency')->json();
        $this->assertDatabaseHas('identity_devices',['id'=>$device,'account_id'=>$account]);
        $this->assertNotNull(DB::table('identity_devices')->where('id',$device)->value('revoked_at'));
        $this->assertDatabaseCount('identity_device_revocation_intents',1);
        $again=$this->send($body)->assertOk()->json();
        $this->assertSame($first,$again);
        $this->send([...$body,'intent'=>'local-delete'])->assertStatus(409);
        $this->assertDatabaseCount('identity_device_revocation_intents',1);
    }
    public function test_unsigned_wrong_device_and_unauthenticated_first_commit_fail_closed():void {
        [$account,$device,$key]=$this->fixture();
        $body=$this->envelope($account,$device,$key['key']);
        $this->send($body)->assertUnauthorized();
        $this->withSession(['identity_account'=>$account,'identity_device'=>$device,
            'identity_issued'=>time()]);
        $other=$this->signer();
        $bad=$this->envelope($account,$device,$other['key']);
        $this->send($bad)->assertUnauthorized();
        $this->assertDatabaseCount('identity_device_revocation_intents',0);
        $this->assertNull(DB::table('identity_devices')->where('id',$device)->value('revoked_at'));
    }
    public function test_origin_and_exact_payload_are_mandatory():void {
        [$account,$device,$key]=$this->fixture();
        $body=$this->envelope($account,$device,$key['key']);
        $this->withSession(['identity_account'=>$account,'identity_device'=>$device,
            'identity_issued'=>time()]);
        $this->putJson('/identity/v2/device-revocations/'.$body['operationId'],$body)->assertForbidden();
        $this->send([...$body,'unexpected'=>'extra'])->assertStatus(422);
        $this->assertDatabaseCount('identity_device_revocation_intents',0);
    }
}
