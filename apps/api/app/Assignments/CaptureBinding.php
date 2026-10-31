<?php
declare(strict_types=1);
namespace App\Assignments;
use App\Identity\Protocol as P;
use Illuminate\Support\Facades\DB;
final class CaptureBinding {
 public static function validate(array $c,string $actor,int $expires):array{
  P::exact($c,['assignmentId','assignmentRevision','policyRevision','mode','retentionDays','capturedAt']);
  P::uuid($c['assignmentId']);
  foreach(['assignmentRevision','policyRevision','mode','retentionDays','capturedAt'] as $name)
   abort_unless(is_int($c[$name]),422);
  abort_unless($c['assignmentRevision']>=1&&$c['policyRevision']>=1&&
   in_array($c['mode'],[2,3],true)&&$c['retentionDays']>=1&&$c['retentionDays']<=45
   &&$c['capturedAt']>0&&$c['capturedAt']<=now()->getTimestampMs()+120000,422);
  abort_unless($expires===$c['capturedAt']+$c['retentionDays']*86400000,422);
  $a=DB::table('assignments')->where('id',$c['assignmentId'])->first();
  abort_unless($a&&$a->account_id===$actor,404);
  // Security gate until peer E2EE wrapping is fully implemented and independently tested.
  abort_unless($a->status==='in_progress',403);
  $policy=DB::table('assignment_capture_policies_v1')
   ->where('assignment_id',$c['assignmentId'])->where('policy_revision',$c['policyRevision'])->first();
  abort_unless($policy,409);
  abort_unless((int)$policy->mode===$c['mode']&&
   (int)$policy->retention_days===$c['retentionDays']&&
   (int)$policy->assignment_revision<=$c['assignmentRevision']&&
   $c['assignmentRevision']<=(int)$a->revision,409);
  // Server-authoritative acceptance timestamps bound the claimed offline capture epoch.
  // A client clock claim is not cryptographic capture-time attestation.
  abort_unless($c['capturedAt']+120000>=\Carbon\Carbon::parse($policy->effective_at)->getTimestampMs(),409);
  $next=DB::table('assignment_capture_policies_v1')
   ->where('assignment_id',$c['assignmentId'])->where('policy_revision','>',$c['policyRevision'])
   ->orderBy('policy_revision')->first();
  if($next)abort_unless($c['capturedAt']<
   \Carbon\Carbon::parse($next->effective_at)->getTimestampMs()+120000,409);
  // The signed snapshot must also correspond to a server-accepted in-progress event.
  $event=DB::table('assignment_history')->where('assignment_id',$c['assignmentId'])
   ->where('revision',$c['assignmentRevision'])->first();
  abort_unless($event && $event->to_status==='in_progress' &&
   $c['capturedAt']+120000>=\Carbon\Carbon::parse($event->accepted_at)->getTimestampMs(),409);
  return $c;
 }
 public static function active(object $photo,string $actor):?object{
  $binding=DB::table('assignment_photo_bindings_v1')->where('photo_id',$photo->id)->first();
  if(!$binding)return null;
  abort_unless($binding->author_account_id===$actor,404);
  abort_if($binding->expires_at<=now()->getTimestampMs(),410);
  abort_unless(DB::table('assignments')->where('id',$binding->assignment_id)
   ->where('account_id',$actor)->exists(),403);
  return $binding;
 }
 public static function record(string $photoId,string $actor,array $c,int $expiry):void{
  DB::table('assignment_photo_bindings_v1')->insert([
   'photo_id'=>$photoId,'assignment_id'=>$c['assignmentId'],
   'author_account_id'=>$actor,'assignment_revision'=>$c['assignmentRevision'],
   'policy_revision'=>$c['policyRevision'],'mode'=>$c['mode'],
   'retention_days'=>$c['retentionDays'],'captured_at'=>$c['capturedAt'],
   'expires_at'=>$expiry,'review_state'=>'pending','review_revision'=>1,
   'created_at'=>now(),'updated_at'=>now(),
  ]);
 }
}
