<?php
declare(strict_types=1);
namespace App\Jobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
final class PhotoAssetCleanupJob implements ShouldQueue{
  use Dispatchable,InteractsWithQueue,Queueable,SerializesModels;
  public int $tries=10;
  public function backoff():array{return [30,60,120,300,900,1800,3600];}
  public function __construct(public readonly string $photoId,public readonly string $assetId){}
  public function handle():void{
    $o=DB::table('photo_objects')->where('id',$this->assetId)->where('photo_id',$this->photoId)->first();
    if(!$o)return;
    $photo=DB::table('photo_records')->where('id',$this->photoId)->first();
    if($photo && $photo->metadata_asset_id===$this->assetId)return;
    $disk=Storage::disk(config('photo_sync.disk'));
    if($disk->exists($o->object_key)&&(!$disk->delete($o->object_key)||$disk->exists($o->object_key)))
      throw new \RuntimeException('gallery.old_asset_cleanup_retry');
    DB::table('photo_objects')->where('id',$this->assetId)->delete();
  }
}
