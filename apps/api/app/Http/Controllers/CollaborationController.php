<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Collaboration\CollaborationContract as C;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CollaborationController extends Controller {
    private function accountExists(string $id):bool {
        return DB::table('identity_accounts')->where('id',$id)->where('status','ready')->exists();
    }
    private function blocked(string $a,string $b):bool {
        return DB::table('contact_blocks_v1')
            ->where(fn($q)=>$q->where('account_id',$a)->where('blocked_account_id',$b))
            ->orWhere(fn($q)=>$q->where('account_id',$b)->where('blocked_account_id',$a))->exists();
    }
    private function pair(string $a,string $b):array {
        return strcmp($a,$b)<0?[$a,$b]:[$b,$a];
    }
    private function contact(string $a,string $b):bool {
        [$left,$right]=$this->pair($a,$b);
        return DB::table('contact_links_v1')->where('left_account_id',$left)
            ->where('right_account_id',$right)->where('state','accepted')->exists();
    }
    private function team(string $id,string $actor,bool $manage=false):array {
        $team=DB::table('teams_v1')->where('id',$id)->first();
        abort_unless($team,404);
        $member=DB::table('team_members_v1')->where('team_id',$id)
            ->where('account_id',$actor)->whereNull('revoked_at')->first();
        // A blocked owner is an immediate authorization denial (no stale role grant).
        abort_unless($member && !$this->blocked($team->owner_account_id,$actor),404);
        if($manage)abort_unless(in_array($member->role,['owner','curator'],true),403);
        return [$team,$member];
    }
    public function snapshot(Request $r) {
        [$actor]=C::actor($r);$aid=$actor->id;
        $blocks=DB::table('contact_blocks_v1')->where('account_id',$aid)->pluck('blocked_account_id')->all();
        $contacts=DB::table('contact_links_v1')
            ->where('left_account_id',$aid)->orWhere('right_account_id',$aid)
            ->limit(500)->get()->map(function($row)use($aid){
                return ['accountId'=>$row->left_account_id===$aid?$row->right_account_id:$row->left_account_id,
                    'requesterId'=>$row->requester_id,'state'=>$row->state];
            })->filter(fn($row)=>!$this->blocked($aid,$row['accountId']))->values()->all();
        $teams=DB::table('team_members_v1 as m')->join('teams_v1 as t','t.id','=','m.team_id')
            ->where('m.account_id',$aid)->whereNull('m.revoked_at')
            ->select('t.*','m.role as my_role')->orderBy('t.updated_at','desc')->limit(200)->get()
            ->filter(fn($row)=>!$this->blocked($row->owner_account_id,$aid))
            ->map(function($row)use($aid){
                $members=DB::table('team_members_v1')->where('team_id',$row->id)->whereNull('revoked_at')
                    ->orderBy('joined_at')->get(['account_id','role'])->map(fn($m)=>[
                        'accountId'=>$m->account_id,'role'=>$m->role])->all();
                return ['id'=>$row->id,'ownerId'=>$row->owner_account_id,'role'=>$row->my_role,
                    'revision'=>(int)$row->revision,
                    'profile'=>json_decode($row->profile_cipher,true,16,JSON_THROW_ON_ERROR),
                    'members'=>$members,'linkedAssignments'=>[], // R2-10 provides explicit bindings; never infer photo grants.
                    'updatedAt'=>$row->updated_at];
            })->values()->all();
        $invites=DB::table('team_invitations_v1')->where('target_account_id',$aid)
            ->where('state','pending')->where('expires_at','>',now())->limit(200)->get()
            ->filter(function($row)use($aid){
                $team=DB::table('teams_v1')->where('id',$row->team_id)->first();
                return $team && !$this->blocked($team->owner_account_id,$aid)
                    && $this->contact($team->owner_account_id,$aid);
            })->map(fn($r)=>['id'=>$r->id,'teamId'=>$r->team_id,
                'inviterId'=>$r->inviter_account_id,'role'=>$r->role,
                'sealedKey'=>json_decode($r->sealed_key,true,16,JSON_THROW_ON_ERROR),
                'codeHash'=>$r->code_hash,'expiresAt'=>$r->expires_at])->values()->all();
        $manageable=array_values(array_map(fn($t)=>$t['id'],array_filter($teams,
            fn($t)=>in_array($t['role'],['owner','curator'],true))));
        $outgoing=DB::table('team_invitations_v1')
            ->whereIn('team_id',$manageable)->where('state','pending')
            ->where('expires_at','>',now())->limit(200)->get()
            ->map(fn($i)=>['id'=>$i->id,'teamId'=>$i->team_id,
                'targetId'=>$i->target_account_id,'role'=>$i->role,'expiresAt'=>$i->expires_at])->all();
        return C::json(['accountId'=>$aid,'contacts'=>$contacts,'blocks'=>$blocks,'teams'=>$teams,
            'invitations'=>$invites,'outgoingInvitations'=>$outgoing,
            'serverTime'=>now()->utc()->format('Y-m-d\TH:i:s.v\Z')]);
    }
    public function mutate(Request $r,string $operationId) {
        C::origin($r);[$actor,$device]=C::actor($r);P::uuid($operationId);
        $body=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature']),422);
        $c=C::input($body['contract'],$body['signature'],$device->signing_spki,$operationId);
        $hash=hash('sha256',$body['contract']);$aid=$actor->id;
        return DB::transaction(function()use($c,$hash,$aid){
            // Stable idempotency key survives lost acknowledgement and retries.
            DB::table('identity_accounts')->where('id',$aid)->lockForUpdate()->first();
            $past=DB::table('collaboration_operations_v1')->where('id',$c['opId'])->first();
            if($past){
                abort_unless($past->actor_account_id===$aid&&hash_equals($past->contract_hash,$hash),409);
                return C::json(json_decode($past->receipt,true,16,JSON_THROW_ON_ERROR));
            }
            $receipt=$this->apply($aid,$c);
            $receipt=['accepted'=>true,'operationId'=>$c['opId'],...$receipt];
            DB::table('collaboration_operations_v1')->insert([
                'id'=>$c['opId'],'actor_account_id'=>$aid,'contract_hash'=>$hash,
                'receipt'=>json_encode($receipt,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'created_at'=>now(),
            ]);
            return C::json($receipt);
        },3);
    }
    private function apply(string $aid,array $c):array {
        $kind=$c['kind'];$target=$c['targetId'];$teamId=$c['teamId'];
        if(in_array($kind,['contact_request','contact_accept','contact_remove','block','unblock'],true)){
            abort_unless($target!==$aid&&$this->accountExists($target),422);
            [$left,$right]=$this->pair($aid,$target);
            $key=['left_account_id'=>$left,'right_account_id'=>$right];
            if($kind==='block'){
                DB::table('contact_blocks_v1')->updateOrInsert(
                    ['account_id'=>$aid,'blocked_account_id'=>$target],['created_at'=>now()]);
                DB::table('contact_links_v1')->where($key)->delete();
                // Revocation is durable: unblocking does not restore old membership.
                $owned=DB::table('teams_v1')->where('owner_account_id',$aid)->pluck('id')->all();
                DB::table('team_members_v1')->whereIn('team_id',$owned)
                    ->where('account_id',$target)->where('role','!=','owner')
                    ->update(['revoked_at'=>now()]);
                $their=DB::table('teams_v1')->where('owner_account_id',$target)->pluck('id')->all();
                DB::table('team_members_v1')->whereIn('team_id',$their)
                    ->where('account_id',$aid)->where('role','!=','owner')
                    ->update(['revoked_at'=>now()]);
                DB::table('team_invitations_v1')->where('state','pending')
                    ->where(fn($q)=>$q->whereIn('team_id',$owned)->where('target_account_id',$target)
                        ->orWhere(fn($s)=>$s->whereIn('team_id',$their)->where('target_account_id',$aid)))
                    ->update(['state'=>'revoked','updated_at'=>now()]);
                return ['state'=>'blocked'];
            }
            if($kind==='unblock'){
                DB::table('contact_blocks_v1')->where('account_id',$aid)
                    ->where('blocked_account_id',$target)->delete();
                return ['state'=>'unblocked'];
            }
            abort_if($this->blocked($aid,$target),403);
            $old=DB::table('contact_links_v1')->where($key)->lockForUpdate()->first();
            if($kind==='contact_remove'){
                DB::table('contact_links_v1')->where($key)->delete();
                return ['state'=>'removed'];
            }
            if($kind==='contact_request'){
                abort_if($old && $old->state==='accepted',409);
                abort_if($old && $old->requester_id!==$aid,409); // use accept, not cross-request auto-accept
                DB::table('contact_links_v1')->updateOrInsert($key,
                    ['requester_id'=>$aid,'state'=>'pending','created_at'=>$old?->created_at??now(),'updated_at'=>now()]);
                return ['state'=>'pending'];
            }
            abort_unless($old && $old->state==='pending'&&$old->requester_id!==$aid,403);
            DB::table('contact_links_v1')->where($key)->update(['state'=>'accepted','updated_at'=>now()]);
            return ['state'=>'accepted'];
        }

        if($kind==='team_create'){
            abort_if(DB::table('teams_v1')->where('id',$teamId)->exists(),409);
            DB::table('teams_v1')->insert(['id'=>$teamId,'owner_account_id'=>$aid,'revision'=>1,
                'profile_cipher'=>json_encode($c['profile'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'created_at'=>now(),'updated_at'=>now()]);
            DB::table('team_members_v1')->insert(['team_id'=>$teamId,'account_id'=>$aid,
                'role'=>'owner','joined_at'=>now(),'revoked_at'=>null]);
            return ['teamId'=>$teamId,'revision'=>1];
        }
        if(in_array($kind,['team_edit','team_delete','team_leave','invite_create','member_role','member_revoke'],true)){
            [$team,$member]=$this->team($teamId,$aid,$kind!=='team_leave');
            if($kind==='team_leave'){
                abort_if($member->role==='owner',403);
                DB::table('team_members_v1')->where('team_id',$teamId)
                    ->where('account_id',$aid)->update(['revoked_at'=>now()]);
                return ['teamId'=>$teamId,'state'=>'left'];
            }
            if($kind==='team_delete'){
                abort_unless($member->role==='owner',403);
                DB::table('teams_v1')->where('id',$teamId)->delete();
                return ['teamId'=>$teamId,'state'=>'deleted'];
            }
            if($kind==='team_edit'){
                if($team->revision!==$c['expectedRevision'])
                    abort(409,'collaboration.revision_conflict');
                DB::table('teams_v1')->where('id',$teamId)->update([
                    'profile_cipher'=>json_encode($c['profile'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                    'revision'=>$team->revision+1,'updated_at'=>now()]);
                return ['teamId'=>$teamId,'revision'=>$team->revision+1];
            }
            if($kind==='invite_create'){
                abort_unless($this->accountExists($target)&&$target!==$aid&&
                    $this->contact($team->owner_account_id,$target)&&!$this->blocked($team->owner_account_id,$target),403);
                if($member->role==='curator')abort_if($c['role']==='curator',403);
                abort_if(DB::table('team_members_v1')->where('team_id',$teamId)
                    ->where('account_id',$target)->whereNull('revoked_at')->exists(),409);
                abort_if(DB::table('team_invitations_v1')->where('id',$c['inviteId'])->exists(),409);
                DB::table('team_invitations_v1')->where('team_id',$teamId)
                    ->where('target_account_id',$target)->where('state','pending')
                    ->update(['state'=>'revoked','updated_at'=>now()]);
                DB::table('team_invitations_v1')->insert([
                    'id'=>$c['inviteId'],'team_id'=>$teamId,'inviter_account_id'=>$aid,
                    'target_account_id'=>$target,'role'=>$c['role'],'code_hash'=>$c['codeHash'],
                    'sealed_key'=>json_encode($c['sealedKey'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                    'state'=>'pending','expires_at'=>now()->addDays(7),'created_at'=>now(),'updated_at'=>now()]);
                return ['inviteId'=>$c['inviteId'],'teamId'=>$teamId,'state'=>'pending'];
            }
            $other=DB::table('team_members_v1')->where('team_id',$teamId)
                ->where('account_id',$target)->whereNull('revoked_at')->first();
            abort_unless($other && $target!==$team->owner_account_id && $target!==$aid,403);
            if($member->role==='curator')
                abort_unless(in_array($other->role,['contributor','viewer'],true) &&
                    ($kind!=='member_role'||in_array($c['role'],['contributor','viewer'],true)),403);
            if($kind==='member_revoke'){
                DB::table('team_members_v1')->where('team_id',$teamId)
                    ->where('account_id',$target)->update(['revoked_at'=>now()]);
                DB::table('team_invitations_v1')->where('team_id',$teamId)
                    ->where('inviter_account_id',$target)->where('state','pending')
                    ->update(['state'=>'revoked','updated_at'=>now()]);
                return ['teamId'=>$teamId,'state'=>'revoked'];
            }
            DB::table('team_members_v1')->where('team_id',$teamId)
                ->where('account_id',$target)->update(['role'=>$c['role']]);
            return ['teamId'=>$teamId,'role'=>$c['role']];
        }

        $invite=DB::table('team_invitations_v1')->where('id',$c['inviteId'])->lockForUpdate()->first();
        abort_unless($invite,404);
        $team=DB::table('teams_v1')->where('id',$invite->team_id)->first();
        abort_unless($team,404);
        if($kind==='invite_revoke'){
            $member=DB::table('team_members_v1')->where('team_id',$team->id)
                ->where('account_id',$aid)->whereNull('revoked_at')->first();
            abort_unless($member&&in_array($member->role,['owner','curator'],true),403);
            if($member->role==='curator')abort_if($invite->role==='curator',403);
            abort_unless($invite->state==='pending',409);
            DB::table('team_invitations_v1')->where('id',$invite->id)->update(['state'=>'revoked','updated_at'=>now()]);
            return ['inviteId'=>$invite->id,'state'=>'revoked'];
        }
        abort_unless($invite->target_account_id===$aid && $invite->state==='pending'
            && $invite->expires_at>now() && !$this->blocked($team->owner_account_id,$aid)
            && $this->contact($team->owner_account_id,$aid),403);
        if($kind==='invite_decline'){
            DB::table('team_invitations_v1')->where('id',$invite->id)->update(['state'=>'declined','updated_at'=>now()]);
            return ['inviteId'=>$invite->id,'state'=>'declined'];
        }
        abort_unless($kind==='invite_accept',422);
        // An invitation cannot outlive the inviter's active authority.
        $inviter=DB::table('team_members_v1')->where('team_id',$team->id)
            ->where('account_id',$invite->inviter_account_id)->whereNull('revoked_at')->first();
        abort_unless($inviter&&in_array($inviter->role,['owner','curator'],true),403);
        if($inviter->role==='curator')abort_if($invite->role==='curator',403);
        $prior=DB::table('team_members_v1')->where('team_id',$team->id)->where('account_id',$aid)->first();
        abort_if($prior && $prior->revoked_at===null,409);
        DB::table('team_members_v1')->updateOrInsert(['team_id'=>$team->id,'account_id'=>$aid],
            ['role'=>$invite->role,'joined_at'=>now(),'revoked_at'=>null]);
        DB::table('team_invitations_v1')->where('id',$invite->id)->update(['state'=>'accepted','updated_at'=>now()]);
        return ['inviteId'=>$invite->id,'teamId'=>$team->id,'state'=>'accepted'];
    }
}
