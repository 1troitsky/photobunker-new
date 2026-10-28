<?php
declare(strict_types=1);
namespace App\Photo;
use App\Jobs\PhotoCleanupJob;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class Lifecycle
{
    public function mark(string $photoId,string $reason='expired'):void {
        DB::transaction(function()use($photoId,$reason){
            $photo=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
            if(!$photo)return;
            // Retain stable opaque IDs forever to reject replays; erase private manifests after deletion.
            $keys=DB::table('photo_objects')->where('photo_id',$photoId)->pluck('object_key')->all();
            DB::table('photo_tombstones')->insertOrIgnore([
                'photo_id'=>$photoId,'account_id'=>$photo->account_id,'operation_id'=>$photo->operation_id,
                'reason'=>$reason,'object_keys'=>json_encode($keys,JSON_THROW_ON_ERROR),
                'cleanup_until'=>now()->addDay(),'created_at'=>now(),
            ]);
            DB::table('photo_records')->where('id',$photoId)->update([
                'state'=>'deleting','cleanup_next_at'=>now()->addMinute(),'updated_at'=>now(),
            ]);
        },3);
    }
    public function cleanup(string $photoId):void {
        $photo=DB::table('photo_records')->where('id',$photoId)->first();
        if(!$photo)return;
        abort_unless($photo->state==='deleting'||$photo->expires_at<=PhotoSync::nowMs(),409);
        if($photo->state!=='deleting')$this->mark($photoId);
        $objects=DB::table('photo_objects')->where('photo_id',$photoId)->get();
        $disk=Storage::disk(config('photo_sync.disk'));
        foreach($objects as $object){
            // Retry until HEAD confirms physical ciphertext is absent; never drop pointers first.
            if($disk->exists($object->object_key)){
                if(!$disk->delete($object->object_key) || $disk->exists($object->object_key))
                    throw new \RuntimeException('photo.cleanup_retry');
            }
        }
        DB::transaction(function()use($photoId){
            $row=DB::table('photo_records')->where('id',$photoId)->lockForUpdate()->first();
            if(!$row)return;
            abort_unless($row->state==='deleting',409);
            DB::table('photo_objects')->where('photo_id',$photoId)->delete();
            DB::table('photo_records')->where('id',$photoId)->delete();
        },3);
    }
    /** Sweeps incomplete uploads without destroying non-expired logical reservations. */
    public function recoverOrphans(int $batch):int {
        $old=now()->subHours((int)config('photo_sync.orphan_grace_hours'));
        $objects=DB::table('photo_objects as o')->join('photo_records as p','p.id','=','o.photo_id')
            ->where('p.state','pending')->whereIn('o.state',['pending','uploading','verified'])
            ->where('o.updated_at','<',$old)->orderBy('o.updated_at')->limit($batch)
            ->select('o.id','o.object_key')->get();
        $removed=0;
        foreach($objects as $o){
            try{
                $disk=Storage::disk(config('photo_sync.disk'));
                if($disk->exists($o->object_key)&&(!$disk->delete($o->object_key)||$disk->exists($o->object_key)))
                    throw new \RuntimeException('photo.orphan_retry');
                DB::table('photo_objects')->where('id',$o->id)->whereIn('state',['pending','uploading','verified'])
                  ->update(['state'=>'pending','updated_at'=>now()]);
                $removed++;
            }catch(\Throwable){ /* bounded next scheduler retry, never log storage credentials */ }
        }
        return $removed;
    }
    /** Keep tombstone object keys for late writes, then clear their private-ish paths. */
    public function sweepTombstones(int $batch):void {
        $rows=DB::table('photo_tombstones')->whereNotNull('object_keys')
            ->where('cleanup_until','<=',now())->orderBy('cleanup_until')->limit($batch)->get();
        foreach($rows as $row){
            try{
                $disk=Storage::disk(config('photo_sync.disk'));
                foreach(json_decode($row->object_keys,true,16,JSON_THROW_ON_ERROR) as $key){
                    if($disk->exists($key)&&(!$disk->delete($key)||$disk->exists($key)))
                        throw new \RuntimeException('photo.tombstone_retry');
                }
                if(now()->greaterThan($row->cleanup_until))
                    DB::table('photo_tombstones')->where('photo_id',$row->photo_id)->update([
                        'object_keys'=>null,'cleanup_until'=>null,
                    ]);
            }catch(\Throwable){ /* retry */ }
        }
    }
}
