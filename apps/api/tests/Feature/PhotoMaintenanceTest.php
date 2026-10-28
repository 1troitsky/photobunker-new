<?php
declare(strict_types=1);
namespace Tests\Feature;
use App\Photo\Lifecycle;
use App\Jobs\PhotoCleanupJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;
final class PhotoMaintenanceTest extends TestCase {
    use RefreshDatabase;
    private function pendingPhoto(int $expires):array {
        $account=(string)Str::uuid();$device=(string)Str::uuid();
        $photo=(string)Str::uuid();$op=(string)Str::uuid();$asset=(string)Str::uuid();
        DB::table('identity_accounts')->insert(['id'=>$account,'operation_id'=>(string)Str::uuid(),
          'prepare_hash'=>str_repeat('a',64),'status'=>'ready','reserved_until'=>now()->addDay(),
          'created_at'=>now(),'updated_at'=>now()]);
        DB::table('identity_devices')->insert(['id'=>$device,'account_id'=>$account,
          'signing_spki'=>'unused-in-maintenance','created_at'=>now(),'updated_at'=>now()]);
        DB::table('photo_records')->insert(['id'=>$photo,'account_id'=>$account,'device_id'=>$device,
          'operation_id'=>$op,'state'=>'pending','expires_at'=>$expires,
          'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}','signature'=>'opaque',
          'created_at'=>now(),'updated_at'=>now()]);
        $key='cipher/v1/'.$account.'/'.$photo.'/'.$asset;
        DB::table('photo_objects')->insert(['id'=>$asset,'photo_id'=>$photo,'kind'=>'metadata',
          'revision'=>1,'bytes'=>32,'sha256'=>str_repeat('c',64),'manifest_json'=>'{}',
          'object_key'=>$key,'state'=>'pending','created_at'=>now(),'updated_at'=>now()]);
        return compact('photo','asset','key');
    }
    public function test_scheduler_queues_bounded_expiry_and_cleanup_is_idempotent():void {
        Queue::fake();Storage::fake('photo-ciphertext');
        $f=$this->pendingPhoto(now()->subMinute()->getTimestampMs());
        Storage::disk('photo-ciphertext')->put($f['key'],random_bytes(32));
        $this->artisan('photobunker:photo-maintain')->assertExitCode(0);
        Queue::assertPushed(PhotoCleanupJob::class,1);
        $this->assertDatabaseHas('photo_tombstones',['photo_id'=>$f['photo']]);
        app(Lifecycle::class)->cleanup($f['photo']);
        app(Lifecycle::class)->cleanup($f['photo']);
        $this->assertSame([],Storage::disk('photo-ciphertext')->allFiles());
        $this->assertDatabaseMissing('photo_records',['id'=>$f['photo']]);
    }
    public function test_orphan_grace_deletes_uncommitted_cipher_without_invalidating_reservation():void {
        Storage::fake('photo-ciphertext');
        $f=$this->pendingPhoto(now()->addDay()->getTimestampMs());
        Storage::disk('photo-ciphertext')->put($f['key'],random_bytes(32));
        DB::table('photo_objects')->where('id',$f['asset'])->update([
            'updated_at'=>now()->subDays(2),'state'=>'uploading',
        ]);
        $this->assertSame(1,app(Lifecycle::class)->recoverOrphans(10));
        $this->assertFalse(Storage::disk('photo-ciphertext')->exists($f['key']));
        $this->assertDatabaseHas('photo_objects',['id'=>$f['asset'],'state'=>'pending']);
        $this->assertDatabaseHas('photo_records',['id'=>$f['photo'],'state'=>'pending']);
    }
}
