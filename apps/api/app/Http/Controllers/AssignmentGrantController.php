<?php
declare(strict_types=1);
namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as A;
use App\Assignments\AssignmentGrantContract as G;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AssignmentGrantController extends Controller {
    private function blocked(string $a,string $b):bool {
        return DB::table('contact_blocks_v1')
            ->where(fn($q)=>$q->where('account_id',$a)->where('blocked_account_id',$b))
            ->orWhere(fn($q)=>$q->where('account_id',$b)->where('blocked_account_id',$a))
            ->exists();
    }
    private function acceptedContact(string $a,string $b):bool {
        [$left,$right]=strcmp($a,$b)<0?[$a,$b]:[$b,$a];
        return DB::table('contact_links_v1')->where('left_account_id',$left)
            ->where('right_account_id',$right)->where('state','accepted')->exists();
    }
    private function trustedPair(string $owner,string $recipient):bool {
        return !$this->blocked($owner,$recipient)&&$this->acceptedContact($owner,$recipient);
    }
    private function row(object $r,string $actor):array {
        return ['grantId'=>$r->id,'assignmentId'=>$r->assignment_id,
            'ownerId'=>$r->owner_account_id,'recipientId'=>$r->recipient_account_id,
            'role'=>$r->role,'state'=>$r->state,'generation'=>(int)$r->generation,
            'inviteExpiresAt'=>(int)$r->invite_expires_at,
            // Only recipient can retrieve encrypted invite envelope; never return raw secret.
            'codeHash'=>$r->recipient_account_id===$actor?$r->code_hash:null,
            'sealedKey'=>$r->recipient_account_id===$actor
                ?json_decode($r->sealed_key,true,12,JSON_THROW_ON_ERROR):null];
    }
    public function index(Request $r){
        [$actor]=A::actor($r);
        $aid=$actor->id;
        $rows=DB::table('assignment_grants_v1')
            ->where(fn($q)=>$q->where('owner_account_id',$aid)
                ->orWhere('recipient_account_id',$aid))
            ->whereIn('state',['pending','accepted'])
            ->orderBy('created_at','desc')->limit(300)->get()
            ->filter(function($grant)use($aid){
                if(!$this->trustedPair($grant->owner_account_id,$grant->recipient_account_id))return false;
                if($grant->state==='pending'&&$grant->invite_expires_at<=now()->getTimestampMs())
                    return false;
                return DB::table('assignments')->where('id',$grant->assignment_id)
                    ->where('account_id',$grant->owner_account_id)->exists();
            })->map(fn($row)=>$this->row($row,$aid))->values()->all();
        return A::json(['grants'=>$rows]);
    }
    public function mutate(Request $r,string $operationId){
        A::origin($r);[$actor,$device]=A::actor($r);P::uuid($operationId);
        $body=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature']),422);
        $c=G::validate($body['contract'],$body['signature'],$device->signing_spki,$operationId);
        $aid=$actor->id;$digest=hash('sha256',$body['contract']);
        return DB::transaction(function()use($c,$aid,$digest){
            DB::table('identity_accounts')->where('id',$aid)->lockForUpdate()->first();
            $old=DB::table('assignment_grant_operations_v1')->where('id',$c['opId'])->first();
            if($old){
                abort_unless($old->actor_account_id===$aid&&hash_equals($old->contract_hash,$digest),409);
                return A::json(json_decode($old->receipt,true,12,JSON_THROW_ON_ERROR));
            }
            $receipt=$this->apply($c,$aid);
            $receipt=['accepted'=>true,'operationId'=>$c['opId'],...$receipt];
            DB::table('assignment_grant_operations_v1')->insert([
                'id'=>$c['opId'],'actor_account_id'=>$aid,'contract_hash'=>$digest,
                'receipt'=>json_encode($receipt,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'created_at'=>now(),
            ]);
            return A::json($receipt);
        },3);
    }
    private function apply(array $c,string $aid):array{
        $kind=$c['kind'];$id=$c['grantId'];$assignmentId=$c['assignmentId'];
        if($kind==='invite'){
            $a=DB::table('assignments')->where('id',$assignmentId)->lockForUpdate()->first();
            abort_unless($a&&$a->account_id===$aid,404);
            abort_unless($a->status!=='completed',403);
            $target=$c['targetId'];
            abort_unless($target!==$aid&&DB::table('identity_accounts')
                ->where('id',$target)->where('status','ready')->exists(),422);
            abort_unless($this->trustedPair($aid,$target),403);
            $now=now()->getTimestampMs();
            abort_unless($c['expiresAt']>$now&&$c['expiresAt']<=$now+7*86400000,422);
            abort_if(DB::table('assignment_grants_v1')->where('id',$id)->exists(),409);
            // Cannot silently create duplicate active rights for the same target.
            abort_if(DB::table('assignment_grants_v1')->where('assignment_id',$assignmentId)
                ->where('recipient_account_id',$target)
                ->where(fn($q)=>$q->where('state','accepted')
                    ->orWhere(fn($pending)=>$pending->where('state','pending')
                        ->where('invite_expires_at','>',$now)))
                ->exists(),409);
            DB::table('assignment_grants_v1')->insert([
                'id'=>$id,'assignment_id'=>$assignmentId,'owner_account_id'=>$aid,
                'recipient_account_id'=>$target,'role'=>$c['role'],'state'=>'pending',
                'generation'=>1,'code_hash'=>$c['codeHash'],
                'sealed_key'=>json_encode($c['sealedKey'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'invite_expires_at'=>$c['expiresAt'],'created_at'=>now(),'updated_at'=>now(),
            ]);
            return ['grantId'=>$id,'generation'=>1,'state'=>'pending'];
        }
        $grant=DB::table('assignment_grants_v1')->where('id',$id)->lockForUpdate()->first();
        abort_unless($grant&&$grant->assignment_id===$assignmentId,404);
        abort_unless((int)$grant->generation===$c['expectedGeneration'],409);
        $isOwner=$grant->owner_account_id===$aid;
        $isRecipient=$grant->recipient_account_id===$aid;
        abort_unless($isOwner||$isRecipient,404);
        if($kind==='revoke'){
            abort_unless($isOwner&&in_array($grant->state,['pending','accepted'],true),403);
        }else{
            abort_unless($isRecipient,403);
            if($kind==='leave')abort_unless($grant->state==='accepted',409);
            else {
                abort_unless($grant->state==='pending'&&
                    $grant->invite_expires_at>now()->getTimestampMs(),409);
                if($kind==='accept'){
                    abort_unless($this->trustedPair($grant->owner_account_id,$aid),403);
                    abort_unless(DB::table('assignments')->where('id',$assignmentId)
                        ->where('account_id',$grant->owner_account_id)->exists(),403);
                }
            }
        }
        $state=match($kind){'accept'=>'accepted','decline'=>'declined',default=>'revoked'};
        DB::table('assignment_grants_v1')->where('id',$id)->update([
            'state'=>$state,'generation'=>$grant->generation+1,
            'accepted_at'=>$kind==='accept'?now():$grant->accepted_at,
            'revoked_at'=>$state==='revoked'?now():$grant->revoked_at,'updated_at'=>now(),
        ]);
        return ['grantId'=>$id,'generation'=>(int)$grant->generation+1,'state'=>$state];
    }
}
