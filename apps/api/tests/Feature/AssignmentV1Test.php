<?php
declare(strict_types=1);
namespace Tests\Feature;
use App\Identity\Protocol as P;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AssignmentV1Test extends TestCase{
    use RefreshDatabase;
    private $signer;
    private string $account;
    private string $device;
    protected function setUp():void{
        parent::setUp();
        $this->signer=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
        $pub=openssl_pkey_get_details($this->signer)['key'];
        $this->account=(string)Str::uuid();$this->device=(string)Str::uuid();
        DB::table('identity_accounts')->insert(['id'=>$this->account,'operation_id'=>(string)Str::uuid(),
          'prepare_hash'=>str_repeat('a',64),'status'=>'ready','reserved_until'=>now()->addDay(),
          'created_at'=>now(),'updated_at'=>now()]);
        DB::table('identity_devices')->insert(['id'=>$this->device,'account_id'=>$this->account,
          'signing_spki'=>P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pub))),
          'created_at'=>now(),'updated_at'=>now()]);
        $this->withSession(['identity_account'=>$this->account,'identity_device'=>$this->device,
          'identity_issued'=>time()])->withHeader('Origin','https://localhost');
    }
    private function signature(string $payload):string{
        openssl_sign($payload,$der,$this->signer,OPENSSL_ALGO_SHA256);
        $pos=2;$fields=[];
        for($n=0;$n<2;$n++){
            if(ord($der[$pos++])!==2)throw new \RuntimeException('bad DER');
            $length=ord($der[$pos++]);
            $part=substr($der,$pos,$length);$pos+=$length;
            $fields[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
        }
        return P::encode(implode('',$fields));
    }
    private function command(string $id,int $before,string $action,string $status,
      int $mode=3,int $ttl=45,int $policy=1,?string $op=null):array{
        $operation=$op??(string)Str::uuid();
        $envelope=$action==='delete'?null:[
          'version'=>1,'accountId'=>$this->account,'assignmentId'=>$id,
          'operationId'=>$operation,'revision'=>$before+1,
          'iv'=>P::encode(random_bytes(12)),
          'wrappedDEK'=>['iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(48))],
          'ciphertext'=>P::encode(random_bytes(120)),
        ];
        $contract=['version'=>1,'assignmentId'=>$id,'operationId'=>$operation,
          'expectedRevision'=>$before,'revision'=>$before+1,'action'=>$action,
          'status'=>$status,'policyRevision'=>$policy,'mode'=>$mode,
          'retentionDays'=>$ttl,'envelope'=>$envelope];
        $raw=json_encode($contract,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return ['contract'=>$raw,'signature'=>$this->signature("photobunker.assignment.v1\n".$raw)];
    }
    private function send(string $id,array $body){
        return $this->putJson('/assignments/v1/'.$id,$body);
    }
    public function test_exact_signed_create_replay_cas_policy_revision_and_forbidden_transition():void{
        $id=(string)Str::uuid();
        $first=$this->command($id,0,'create','waiting');
        $this->send($id,$first)->assertOk()->assertJsonPath('revision',1);
        $this->send($id,$first)->assertOk()->assertJsonPath('replayed',true);
        $this->getJson('/assignments/v1/'.$id.'/progress')->assertOk()
          ->assertJsonPath('assignmentId',$id)->assertJsonPath('confirmed',0);
        $this->assertSame(1,DB::table('assignment_history')->where('assignment_id',$id)->count());
        $this->getJson('/assignments/v1/list')->assertOk()->assertJsonCount(1,'assignments')
          ->assertDontSee('private title');
        $forbidden=$this->command($id,1,'transition','completed');
        $this->send($id,$forbidden)->assertStatus(422);
        $this->assertSame(1,DB::table('assignment_history')->where('assignment_id',$id)->count());
        $inProgress=$this->command($id,1,'transition','in_progress');
        $this->send($id,$inProgress)->assertOk()->assertJsonPath('revision',2);
        $stale=$this->command($id,1,'edit','in_progress');
        $this->send($id,$stale)->assertStatus(409)->assertJsonPath('currentRevision',2);
        $policy=$this->command($id,2,'edit','in_progress',2,1,2);
        $this->send($id,$policy)->assertOk()->assertJsonPath('revision',3);
        $this->assertDatabaseHas('assignments',['id'=>$id,'policy_revision'=>2,'retention_days'=>1,'mode'=>2]);
        $this->assertSame(3,DB::table('assignment_history')->where('assignment_id',$id)->count());
    }
    public function test_private_policy_change_and_archive_of_completed_assignment_are_signed_and_revisioned():void{
        $id=(string)Str::uuid();
        $this->send($id,$this->command($id,0,'create','waiting'))->assertOk();
        // E2EE-only policy changed without publicly visible mode/TTL mutation.
        $this->send($id,$this->command($id,1,'edit','waiting',3,45,2))->assertOk();
        $this->assertDatabaseHas('assignments',['id'=>$id,'policy_revision'=>2]);
        $this->send($id,$this->command($id,2,'transition','in_progress',3,45,2))->assertOk();
        $this->send($id,$this->command($id,3,'transition','submitted',3,45,2))->assertOk();
        $this->send($id,$this->command($id,4,'transition','completed',3,45,2))->assertOk();
        $this->send($id,$this->command($id,5,'edit','completed',3,45,2))->assertStatus(422);
        $archive=$this->command($id,5,'archive','completed',3,45,2);
        $this->send($id,$archive)->assertOk()->assertJsonPath('revision',6);
        $this->send($id,$archive)->assertOk()->assertJsonPath('replayed',true);
        $this->assertDatabaseHas('assignments',['id'=>$id,'status'=>'completed','policy_revision'=>2]);
        $this->send($id,$this->command($id,6,'archive','completed',2,45,2))->assertStatus(422);
    }
    public function test_delete_retains_tombstone_and_rejects_late_write():void{
        $id=(string)Str::uuid();
        $this->send($id,$this->command($id,0,'create','waiting'))->assertOk();
        $delete=$this->command($id,1,'delete','waiting');
        $this->send($id,$delete)->assertOk()->assertJsonPath('deleted',true);
        $this->send($id,$delete)->assertOk()->assertJsonPath('replayed',true);
        $this->getJson('/assignments/v1/'.$id)->assertStatus(410);
        $this->getJson('/assignments/v1/list')->assertOk()->assertJsonCount(0,'assignments');
        $this->send($id,$this->command($id,2,'edit','waiting'))->assertStatus(410);
        $this->assertDatabaseMissing('assignments',['id'=>$id]);
        $this->assertDatabaseMissing('assignment_history',['assignment_id'=>$id]);
        $this->assertDatabaseHas('assignment_tombstones',['assignment_id'=>$id]);
    }
    public function test_bad_signature_mode_one_and_other_account_access_are_denied():void{
        $id=(string)Str::uuid();
        $bad=$this->command($id,0,'create','waiting',1);
        $this->send($id,$bad)->assertStatus(422);
        $valid=$this->command($id,0,'create','waiting');
        $valid['signature']=P::encode(random_bytes(64));
        $this->send($id,$valid)->assertUnauthorized();
        $this->send($id,$this->command($id,0,'create','waiting'))->assertOk();
        $this->withSession(['identity_account'=>(string)Str::uuid(),
            'identity_device'=>$this->device,'identity_issued'=>time()])
          ->getJson('/assignments/v1/'.$id)->assertUnauthorized();
    }
}
