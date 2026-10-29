<?php
declare(strict_types=1);

namespace Tests\Feature;

use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class CollaborationV1Test extends TestCase {
    use RefreshDatabase;
    private array $accounts=[];
    private array $devices=[];
    private array $signers=[];
    private string $current;

    protected function setUp():void {
        parent::setUp();
        $this->makeActor('owner');
        $this->makeActor('guest');
        $this->makeActor('outsider');
        $this->beActor('owner');
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
    private function beActor(string $name):void {
        $this->current=$name;
        $this->withSession([
            'identity_account'=>$this->accounts[$name],
            'identity_device'=>$this->devices[$name],'identity_issued'=>time(),
        ])->withHeader('Origin','https://localhost');
    }
    private function signature(string $payload):string {
        openssl_sign($payload,$der,$this->signers[$this->current],OPENSSL_ALGO_SHA256);
        $offset=2;$parts=[];
        for($n=0;$n<2;$n++){
            if(ord($der[$offset++])!==2)throw new \RuntimeException('Invalid DER');
            $length=ord($der[$offset++]);
            $part=substr($der,$offset,$length);$offset+=$length;
            $parts[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$parts));
    }
    private function profile():array {
        return ['v'=>1,'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(128))];
    }
    private function sealedKey():array {
        return ['v'=>1,'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(48))];
    }
    private function action(string $kind,array $values=[],?string $op=null):array {
        $id=$op??(string)Str::uuid();
        $contract=array_merge([
            'v'=>1,'opId'=>$id,'kind'=>$kind,'teamId'=>null,'targetId'=>null,
            'role'=>null,'expectedRevision'=>null,'profile'=>null,'inviteId'=>null,
            'codeHash'=>null,'sealedKey'=>null,
        ],$values);
        $raw=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['opId'=>$id,'contract'=>$raw,
            'signature'=>$this->signature("photobunker.collaboration.v1\n".$raw)];
    }
    private function send(array $action) {
        return $this->putJson('/collaboration/v1/operations/'.$action['opId'],
            ['contract'=>$action['contract'],'signature'=>$action['signature']]);
    }
    private function acceptedContacts():void {
        $to=$this->accounts['guest'];
        $this->send($this->action('contact_request',['targetId'=>$to]))->assertOk()->assertJsonPath('state','pending');
        $this->beActor('guest');
        $this->send($this->action('contact_accept',['targetId'=>$this->accounts['owner']]))
            ->assertOk()->assertJsonPath('state','accepted');
        $this->beActor('owner');
    }
    public function test_contact_requires_two_party_acceptance_and_block_removes_grants():void {
        $target=$this->accounts['guest'];
        $this->send($this->action('contact_request',['targetId'=>$target]))->assertOk();
        $this->assertDatabaseHas('contact_links_v1',['state'=>'pending']);
        $this->send($this->action('contact_accept',['targetId'=>$target]))->assertForbidden();
        $this->beActor('guest');
        $this->send($this->action('contact_accept',['targetId'=>$this->accounts['owner']]))
            ->assertOk();
        $this->beActor('owner');
        $this->send($this->action('block',['targetId'=>$target]))->assertOk();
        $this->send($this->action('contact_request',['targetId'=>$target]))->assertForbidden();
        $this->beActor('guest');
        $this->send($this->action('contact_request',['targetId'=>$this->accounts['owner']]))
            ->assertForbidden();
        $this->assertDatabaseMissing('contact_links_v1',['state'=>'accepted']);
    }
    public function test_team_member_requires_contact_explicit_invitation_and_never_receives_photo_grant():void {
        $team=(string)Str::uuid();
        $create=$this->action('team_create',['teamId'=>$team,
            'expectedRevision'=>0,'profile'=>$this->profile()]);
        $this->send($create)->assertOk()->assertJsonPath('revision',1);
        $this->send($create)->assertOk()->assertJsonPath('revision',1);
        $this->assertSame(1,DB::table('teams_v1')->where('id',$team)->count());
        $guest=$this->accounts['guest'];$inv=(string)Str::uuid();
        $args=['teamId'=>$team,'targetId'=>$guest,'role'=>'contributor','inviteId'=>$inv,
            'codeHash'=>str_repeat('a',64),'sealedKey'=>$this->sealedKey()];
        $this->send($this->action('invite_create',$args))->assertForbidden();
        $this->acceptedContacts();
        $this->send($this->action('invite_create',$args))->assertOk()->assertJsonPath('state','pending');
        $this->beActor('guest');
        $this->getJson('/collaboration/v1/snapshot')->assertOk()->assertJsonCount(1,'invitations');
        $this->send($this->action('invite_accept',['inviteId'=>$inv]))
            ->assertOk()->assertJsonPath('state','accepted');
        $this->getJson('/collaboration/v1/snapshot')->assertOk()
            ->assertJsonPath('teams.0.id',$team)->assertJsonPath('teams.0.role','contributor')
            ->assertJsonPath('teams.0.linkedAssignments',[]);
        // Team membership cannot grant owner-only assignment or photo reads.
        $this->getJson('/assignments/v1/list')->assertOk()->assertJsonCount(0,'assignments');
        $this->beActor('outsider');
        $this->getJson('/collaboration/v1/snapshot')->assertOk()->assertJsonCount(0,'teams');
        $this->send($this->action('member_revoke',['teamId'=>$team,'targetId'=>$guest]))
            ->assertNotFound();
        $this->beActor('owner');
        $this->send($this->action('member_revoke',['teamId'=>$team,'targetId'=>$guest]))
            ->assertOk()->assertJsonPath('state','revoked');
        $this->beActor('guest');
        $this->getJson('/collaboration/v1/snapshot')->assertOk()->assertJsonCount(0,'teams');
    }
    public function test_revision_cas_role_restrictions_and_invalid_signature():void {
        $team=(string)Str::uuid();
        $this->send($this->action('team_create',['teamId'=>$team,
            'expectedRevision'=>0,'profile'=>$this->profile()]))->assertOk();
        $this->send($this->action('team_edit',['teamId'=>$team,
            'expectedRevision'=>0,'profile'=>$this->profile()]))->assertStatus(409);
        $this->send($this->action('team_edit',['teamId'=>$team,
            'expectedRevision'=>1,'profile'=>$this->profile()]))->assertOk()
            ->assertJsonPath('revision',2);
        $wrong=$this->action('team_delete',['teamId'=>$team]);
        $wrong['signature']=P::encode(random_bytes(64));
        $this->send($wrong)->assertUnauthorized();
        $this->assertDatabaseHas('teams_v1',['id'=>$team,'revision'=>2]);
        $this->beActor('guest');
        $this->send($this->action('team_delete',['teamId'=>$team]))->assertNotFound();
    }
}
