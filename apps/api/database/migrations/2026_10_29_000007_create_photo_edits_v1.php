<?php
declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration{
 public function up():void{
  Schema::table('photo_records',function(Blueprint $t){
   $t->unsignedInteger('edit_revision')->default(0);
   $t->uuid('edit_asset_id')->nullable();
  });
  Schema::table('photo_objects',function(Blueprint $t){
   $t->uuid('edit_operation_id')->nullable()->index();
  });
  Schema::create('photo_edit_operations_v1',function(Blueprint $t){
   $t->uuid('id')->primary();
   $t->uuid('photo_id')->index();
   $t->uuid('account_id')->index();
   $t->uuid('asset_id')->unique();
   $t->unsignedInteger('expected_revision');
   $t->unsignedInteger('revision');
   $t->string('kind',12);
   $t->char('contract_hash',64);
   $t->string('state',12); // pending | active
   $t->timestampsTz();
  });
 }
 public function down():void{
  Schema::dropIfExists('photo_edit_operations_v1');
  Schema::table('photo_objects',fn(Blueprint $t)=>$t->dropColumn('edit_operation_id'));
  Schema::table('photo_records',fn(Blueprint $t)=>$t->dropColumn(['edit_revision','edit_asset_id']));
 }
};
