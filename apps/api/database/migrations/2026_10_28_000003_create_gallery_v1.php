<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
return new class extends Migration {
  public function up():void {
    Schema::create('photo_name_allocator',function(Blueprint $t){$t->unsignedTinyInteger('id')->primary();$t->unsignedInteger('next_prefix')->default(0);});
    DB::table('photo_name_allocator')->insert(['id'=>1,'next_prefix'=>0]);
    Schema::create('photo_name_prefixes',function(Blueprint $t){
      $t->char('prefix',4)->primary();$t->uuid('account_id')->index();
      $t->unsignedInteger('sequence')->unique();$t->unsignedInteger('next_number')->default(1);
    });
    Schema::create('photo_name_leases',function(Blueprint $t){
      $t->uuid('id')->primary();$t->uuid('account_id')->index();$t->uuid('device_id');
      $t->uuid('request_id');$t->char('prefix',4);
      $t->unsignedSmallInteger('first_number');$t->unsignedSmallInteger('last_number');
      $t->timestampTz('created_at')->useCurrent();
      $t->unique(['account_id','device_id','request_id'],'name_lease_request_once');
    });
    Schema::create('photo_name_codes',function(Blueprint $t){
      $t->uuid('photo_id')->primary();$t->char('code',8)->unique();
      $t->uuid('account_id');$t->uuid('device_id');$t->uuid('lease_id');
      $t->timestampTz('created_at')->useCurrent();$t->index('account_id');
      // Codes deliberately survive parent expiry; never recycled.
    });
    Schema::table('photo_records',function(Blueprint $t){
      $t->uuid('metadata_asset_id')->nullable();
      $t->unsignedInteger('metadata_revision')->default(1);
      $t->index(['account_id','state','expires_at','id'],'gallery_active_cursor');
    });
    // Pre-existing R2-05 active photos have metadata but no dedicated pointer.
    foreach(DB::table('photo_records')->whereNull('metadata_asset_id')->select('id')->cursor() as $p){
      $asset=DB::table('photo_objects')->where('photo_id',$p->id)->where('kind','metadata')
        ->where('revision',1)->value('id');
      if($asset)DB::table('photo_records')->where('id',$p->id)->update(['metadata_asset_id'=>$asset]);
    }
  }
  public function down():void {
    Schema::table('photo_records',function(Blueprint $t){
      $t->dropIndex('gallery_active_cursor');$t->dropColumn(['metadata_asset_id','metadata_revision']);
    });
    Schema::dropIfExists('photo_name_codes');Schema::dropIfExists('photo_name_leases');
    Schema::dropIfExists('photo_name_prefixes');Schema::dropIfExists('photo_name_allocator');
  }
};