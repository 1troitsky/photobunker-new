<?php
declare(strict_types=1);
namespace App\Console\Commands;
use App\Jobs\PhotoCleanupJob;
use App\Photo\Lifecycle;
use App\Photo\PhotoSync;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
final class PhotoMaintain extends Command {
    protected $signature='photobunker:photo-maintain';
    protected $description='Bounded durable expired-photo cleanup and pending ciphertext orphan GC';
    public function handle(Lifecycle $service):int {
        $batch=min(500,max(1,(int)config('photo_sync.cleanup_batch',100)));
        $ids=DB::table('photo_records')
          ->where(function($q){
              $q->where('expires_at','<=',PhotoSync::nowMs())
                ->orWhere('state','deleting');
          })
          ->where(function($q){
              $q->whereNull('cleanup_next_at')->orWhere('cleanup_next_at','<=',now());
          })
          ->orderBy('expires_at')->orderBy('id')->limit($batch)->pluck('id');
        foreach($ids as $id){
            $service->mark($id);
            PhotoCleanupJob::dispatch($id);
        }
        $service->recoverOrphans($batch);
        $service->sweepTombstones($batch);
        $this->line('Photo maintenance enqueued '.count($ids).' bounded cleanup jobs.');
        return self::SUCCESS;
    }
}
