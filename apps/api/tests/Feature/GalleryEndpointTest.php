<?php
declare(strict_types=1);
namespace Tests\Feature;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;
final class GalleryEndpointTest extends TestCase{
 use RefreshDatabase;
 public function test_gallery_requires_authenticated_account_device_and_omits_private_metadata():void{
   $this->getJson('/photos/v1/list')->assertUnauthorized();
   $a=(string)Str::uuid();$d=(string)Str::uuid();$p=(string)Str::uuid();
   DB::table('identity_accounts')->insert(['id'=>$a,'operation_id'=>(string)Str::uuid(),
     'prepare_hash'=>str_repeat('a',64),'status'=>'ready','reserved_until'=>now()->addDay(),
     'created_at'=>now(),'updated_at'=>now()]);
   DB::table('identity_devices')->insert(['id'=>$d,'account_id'=>$a,
     'signing_spki'=>'test','created_at'=>now(),'updated_at'=>now()]);
   DB::table('photo_records')->insert(['id'=>$p,'account_id'=>$a,'device_id'=>$d,
     'operation_id'=>(string)Str::uuid(),'state'=>'active',
     'expires_at'=>now()->addDay()->getTimestampMs(),'contract_hash'=>str_repeat('c',64),
     'contract_json'=>'{}','signature'=>'test','metadata_asset_id'=>(string)Str::uuid(),
     'created_at'=>now(),'updated_at'=>now()]);
   $this->withSession(['identity_account'=>$a,'identity_device'=>$d,
     'identity_issued'=>time()])->getJson('/photos/v1/list')->assertOk()
     ->assertJsonCount(1,'photos')->assertDontSee('gps')->assertDontSee('title');
   DB::table('photo_records')->where('id',$p)->update(['expires_at'=>now()->subSecond()->getTimestampMs()]);
   $this->getJson('/photos/v1/list')->assertOk()->assertJsonCount(0,'photos');
 }
}
