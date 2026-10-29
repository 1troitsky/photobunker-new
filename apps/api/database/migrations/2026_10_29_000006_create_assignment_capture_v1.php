<?php
declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up():void{
  Schema::create('assignment_capture_policies_v1',function(Blueprint $t){
   $t->uuid('assignment_id')->index();$t->unsignedInteger('policy_revision');
   $t->unsignedInteger('assignment_revision');$t->unsignedTinyInteger('mode');
   $t->unsignedTinyInteger('retention_days');$t->timestampTz('effective_at');
   $t->primary(['assignment_id','policy_revision']);
  });
  Schema::create('assignment_photo_bindings_v1',function(Blueprint $t){
   $t->uuid('photo_id')->primary();$t->uuid('assignment_id')->index();
   $t->uuid('author_account_id')->index();$t->unsignedInteger('assignment_revision');
   $t->unsignedInteger('policy_revision');$t->unsignedTinyInteger('mode');
   $t->unsignedTinyInteger('retention_days');$t->unsignedBigInteger('captured_at');
   $t->unsignedBigInteger('expires_at');$t->string('review_state',16)->default('pending');
   $t->unsignedInteger('review_revision')->default(1);$t->text('review_cipher')->nullable();
   $t->text('response_cipher')->nullable();$t->timestampTz('reviewed_at')->nullable();
   $t->timestampTz('responded_at')->nullable();$t->timestampsTz();
   $t->index(['assignment_id','expires_at']);
  });
  Schema::create('assignment_review_operations_v1',function(Blueprint $t){
   $t->uuid('id')->primary();$t->uuid('photo_id')->index();$t->uuid('actor_id')->index();
   $t->char('contract_hash',64);$t->unsignedInteger('revision');
   $t->timestampTz('accepted_at');
  });
  // Earlier policy snapshots are unknowable: bootstrap the latest *verified* version only.
  DB::table('assignments')->orderBy('id')->chunk(200,function($rows){
   foreach($rows as $row)DB::table('assignment_capture_policies_v1')->insert([
    'assignment_id'=>$row->id,'policy_revision'=>$row->policy_revision,
    'assignment_revision'=>$row->revision,'mode'=>$row->mode,
    'retention_days'=>$row->retention_days,'effective_at'=>$row->updated_at,
   ]);
  });
 }
 public function down():void{
  Schema::dropIfExists('assignment_review_operations_v1');
  Schema::dropIfExists('assignment_photo_bindings_v1');
  Schema::dropIfExists('assignment_capture_policies_v1');
 }
};
