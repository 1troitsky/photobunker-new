<?php
declare(strict_types=1);

/**
 * Live PostgreSQL + Garage integrity/GC gate.
 * Run ONLY with a disposable PostgreSQL database and an isolated Garage bucket.
 * No Storage::fake(), SQLite or production credentials.
 */
use App\Photo\Lifecycle;
use App\Photo\PhotoSync;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app=require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function check(bool $condition,string $message):void {
    if(!$condition)throw new RuntimeException('G1_INTEGRATION_FAILURE: '.$message);
}
check(config('database.default')==='pgsql','PostgreSQL required');
check(config('photo_sync.disk')==='photo-ciphertext','real S3 disk required');
check((string)config('filesystems.disks.photo-ciphertext.driver')==='s3','S3 driver required');
check((string)config('filesystems.disks.photo-ciphertext.endpoint')==='http://127.0.0.1:3900',
    'isolated Garage endpoint required');
check((string)config('filesystems.disks.photo-ciphertext.bucket')==='pb2-ci-g1',
    'isolated CI bucket required');
check(DB::connection()->getDriverName()==='pgsql','live PostgreSQL connection required');

$disk=Storage::disk('photo-ciphertext');
$lifecycle=app(Lifecycle::class);
$account=(string)Str::uuid();
$device=(string)Str::uuid();
$photo=(string)Str::uuid();
$asset=(string)Str::uuid();
$key=app(PhotoSync::class)->objectKey($account,$photo,$asset);
$op=(string)Str::uuid();
$bytes=random_bytes(4096);
$now=now();

DB::table('identity_accounts')->insert([
  'id'=>$account,'operation_id'=>(string)Str::uuid(),'prepare_hash'=>str_repeat('a',64),
  'status'=>'ready','reserved_until'=>now()->addDay(),
  'created_at'=>$now,'updated_at'=>$now,
]);
DB::table('identity_devices')->insert([
  'id'=>$device,'account_id'=>$account,'signing_spki'=>'isolated-g1-integration-only',
  'created_at'=>$now,'updated_at'=>$now,
]);
DB::table('photo_records')->insert([
  'id'=>$photo,'account_id'=>$account,'device_id'=>$device,'operation_id'=>$op,
  'state'=>'pending','expires_at'=>now()->addDay()->getTimestampMs(),
  'contract_hash'=>str_repeat('b',64),'contract_json'=>'{}','signature'=>'ci-opaque',
  'created_at'=>$now,'updated_at'=>$now,
]);
DB::table('photo_objects')->insert([
  'id'=>$asset,'photo_id'=>$photo,'kind'=>'metadata','revision'=>1,
  'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),
  'manifest_json'=>'{}','object_key'=>$key,'state'=>'uploading',
  'created_at'=>$now,'updated_at'=>$now,
]);

try {
    check($disk->put($key,$bytes)!==false,'Garage PUT failed');
    check(app(PhotoSync::class)->verify($key,strlen($bytes),hash('sha256',$bytes)),
        'Garage readback SHA-256 mismatch');
    check(!$lifecycle->recoverOrphans(10),'fresh uploading ciphertext must not be swept');
    DB::table('photo_objects')->where('id',$asset)->update([
        'state'=>'uploading','updated_at'=>now()->subHours(48),
    ]);
    check($lifecycle->recoverOrphans(10)===1,'old incomplete upload not reclaimed');
    check(!$disk->exists($key),'old incomplete upload still physically present');
    check(DB::table('photo_records')->where('id',$photo)->value('state')==='pending',
        'orphan cleanup deleted valid photo reservation');

    // Restartable reservation: upload same ciphertext again and then expire.
    check($disk->put($key,$bytes)!==false,'retry upload failed');
    check(app(PhotoSync::class)->verify($key,strlen($bytes),hash('sha256',$bytes)),
        'retry SHA-256 readback failed');
    DB::table('photo_records')->where('id',$photo)->update([
        'expires_at'=>now()->subMinute()->getTimestampMs(),
    ]);
    try {
        app(PhotoSync::class)->requirePhoto($photo,$account);
        throw new RuntimeException('expired photo unexpectedly accessible');
    } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
        check($e->getStatusCode()===410,'expiry must return 410');
    }
    $lifecycle->mark($photo);
    $lifecycle->cleanup($photo);
    check(!DB::table('photo_records')->where('id',$photo)->exists(),
        'cleanup left PostgreSQL photo');
    check(!$disk->exists($key),'cleanup left Garage ciphertext');

    // Simulates an already in-flight object-store writer completing after DB deletion.
    check($disk->put($key,$bytes)!==false,'late Garage write setup failed');
    DB::table('photo_tombstones')->where('photo_id',$photo)
      ->update(['cleanup_until'=>now()->subMinute()]);
    $lifecycle->sweepTombstones(10);
    check(!$disk->exists($key),'tombstone sweep left late Garage object');
    check(DB::table('photo_tombstones')->where('photo_id',$photo)
        ->whereNull('object_keys')->exists(),'tombstone private keys not cleared');
    check(DB::table('photo_tombstones')->where('photo_id',$photo)->exists(),
        'replay protection unexpectedly removed');
    fwrite(STDOUT,"G1_REAL_GARAGE_POSTGRES_PASS\n");
} finally {
    // This CI-only fixture is isolated; never remove persistent production records.
    if($disk->exists($key))$disk->delete($key);
}
