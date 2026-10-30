<?php
declare(strict_types=1);
namespace App\Http\Controllers;

use App\Assignments\AssignmentContract as C;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AssignmentController extends Controller {
    public function index(Request $r){
        [$a]=C::actor($r);
        $rows=DB::table('assignments')->where('account_id',$a->id)
          ->orderBy('id')->limit(500)->get()->map(fn($row)=>C::dto($row))->all();
        return C::json(['assignments'=>$rows]);
    }
    public function show(Request $r,string $assignmentId){
        [$a]=C::actor($r);P::uuid($assignmentId);
        $row=DB::table('assignments')->where('id',$assignmentId)->where('account_id',$a->id)->first();
        if(!$row){abort_if(DB::table('assignment_tombstones')->where('assignment_id',$assignmentId)
          ->where('account_id',$a->id)->exists(),410);abort(404);}
        return C::json(C::dto($row));
    }
    public function history(Request $r,string $assignmentId){
        [$a]=C::actor($r);P::uuid($assignmentId);
        abort_unless(DB::table('assignments')->where('id',$assignmentId)->where('account_id',$a->id)->exists(),404);
        $rows=DB::table('assignment_history')->where('assignment_id',$assignmentId)
           ->where('account_id',$a->id)->orderBy('revision')->limit(10000)->get();
        return C::json(['history'=>$rows->map(fn($row)=>[
          'operationId'=>$row->operation_id,'action'=>$row->action,'revision'=>(int)$row->revision,
          'fromStatus'=>$row->from_status,'toStatus'=>$row->to_status,
          'policyRevision'=>(int)$row->policy_revision,
          'envelope'=>json_decode($row->cipher_envelope,true),
          'acceptedAt'=>\Carbon\Carbon::parse($row->accepted_at)->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ])->all()]);
    }
    public function mutate(Request $r,string $assignmentId){
        C::origin($r);[$a,$device]=C::actor($r);
        P::uuid($assignmentId);
        $body=P::exact($r->json()->all(),['contract','signature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature']),422);
        $c=C::validate($body['contract'],$body['signature'],$device->signing_spki,$assignmentId,$a->id);
        $hash=hash('sha256',$body['contract']);
        return DB::transaction(function() use($a,$c,$hash,$assignmentId){
            // Serialize all mutations for an account (including first create and deletion).
            DB::table('identity_accounts')->where('id',$a->id)->lockForUpdate()->first();
            $past=DB::table('assignment_operations')->where('operation_id',$c['operationId'])->first();
            if($past){
                abort_unless($past->account_id===$a->id&&$past->assignment_id===$assignmentId&&
                    hash_equals($past->contract_hash,$hash),409);
                return C::json(['accepted'=>true,'revision'=>(int)$past->accepted_revision,'replayed'=>true]);
            }
            abort_if(DB::table('assignment_tombstones')->where('assignment_id',$assignmentId)->exists(),410);
            $row=DB::table('assignments')->where('id',$assignmentId)->lockForUpdate()->first();
            if($row && $row->account_id!==$a->id)abort(404);
            $actual=$row?(int)$row->revision:0;
            if($actual!==$c['expectedRevision'])
              return C::json(['error'=>'assignment.conflict','currentRevision'=>$actual],409);
            if(!$row && $c['action']!=='create')abort(404);
            if($row && $c['action']==='create')abort(409);
            if($row){
                if($c['action']==='transition'){
                    abort_unless(in_array($c['status'],C::MOVES[$row->status]??[],true),422);
                    abort_unless($c['mode']===(int)$row->mode &&
                      $c['retentionDays']===(int)$row->retention_days &&
                      $c['policyRevision']===(int)$row->policy_revision,422);
                }elseif($c['action']==='edit'){
                    abort_unless($c['status']===$row->status&&$row->status!=='completed',422);
                    $changed=$c['mode']!==(int)$row->mode ||
                        $c['retentionDays']!==(int)$row->retention_days;
                    // Additional private E2EE camera requirements cannot be inspected
                    // server-side; an authenticated device may advance their policy revision.
                    $delta=$c['policyRevision']-(int)$row->policy_revision;
                    abort_unless($changed?$delta===1:in_array($delta,[0,1],true),422);
                }elseif($c['action']==='archive'){
                    // Archive is a separate signed lifecycle action, including completed
                    // tasks. Status and public capture contract remain unmodified.
                    abort_unless($c['status']===$row->status &&
                        $c['mode']===(int)$row->mode &&
                        $c['retentionDays']===(int)$row->retention_days &&
                        $c['policyRevision']===(int)$row->policy_revision,422);
                }else{
                    abort_unless($c['action']==='delete'&&$c['status']===$row->status&&
                      $c['policyRevision']===(int)$row->policy_revision&&
                      $c['mode']===(int)$row->mode&&
                      $c['retentionDays']===(int)$row->retention_days,422);
                }
            }
            $now=now();
            DB::table('assignment_operations')->insert([
                'operation_id'=>$c['operationId'],'assignment_id'=>$assignmentId,
                'account_id'=>$a->id,'contract_hash'=>$hash,
                'accepted_revision'=>$c['revision'],'accepted_at'=>$now,
            ]);
            if($c['action']==='delete'){
                DB::table('assignment_tombstones')->insert([
                    'assignment_id'=>$assignmentId,'account_id'=>$a->id,
                    'revision'=>$c['revision'],'deleted_at'=>$now,
                ]);
                DB::table('assignment_history')->where('assignment_id',$assignmentId)->delete();
                DB::table('assignments')->where('id',$assignmentId)->delete();
                return C::json(['accepted'=>true,'deleted'=>true,'revision'=>$c['revision']]);
            }
            $values=[
                'status'=>$c['status'],'revision'=>$c['revision'],
                'policy_revision'=>$c['policyRevision'],'mode'=>$c['mode'],
                'retention_days'=>$c['retentionDays'],
                'cipher_envelope'=>json_encode($c['envelope'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'last_operation_id'=>$c['operationId'],'updated_at'=>$now,
            ];
            if(!$row)DB::table('assignments')->insert([
                ...$values,'id'=>$assignmentId,'account_id'=>$a->id,'created_at'=>$now,
            ]);
            else DB::table('assignments')->where('id',$assignmentId)->update($values);
            if(!$row || (int)$row->policy_revision!==$c['policyRevision']){
                DB::table('assignment_capture_policies_v1')->insert([
                    'assignment_id'=>$assignmentId,'policy_revision'=>$c['policyRevision'],
                    'assignment_revision'=>$c['revision'],'mode'=>$c['mode'],
                    'retention_days'=>$c['retentionDays'],'effective_at'=>$now,
                ]);
            }
            DB::table('assignment_history')->insert([
                'operation_id'=>$c['operationId'],'assignment_id'=>$assignmentId,
                'account_id'=>$a->id,'action'=>$c['action'],
                'from_status'=>$row?->status,'to_status'=>$c['status'],
                'revision'=>$c['revision'],'policy_revision'=>$c['policyRevision'],
                'cipher_envelope'=>json_encode($c['envelope'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                'accepted_at'=>$now,
            ]);
            return C::json(['accepted'=>true,'revision'=>$c['revision'],'acceptedAt'=>$now->utc()->format('Y-m-d\TH:i:s.v\Z')]);
        },3);
    }
}
