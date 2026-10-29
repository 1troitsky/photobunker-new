<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up():void {
        Schema::create('assignments',function(Blueprint $t){
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('status',20);$t->unsignedInteger('revision');
            $t->unsignedInteger('policy_revision');$t->unsignedTinyInteger('mode');
            $t->unsignedTinyInteger('retention_days');
            $t->longText('cipher_envelope');
            $t->uuid('last_operation_id');
            $t->timestampsTz();
            $t->index(['account_id','updated_at','id']);
        });
        Schema::create('assignment_operations',function(Blueprint $t){
            $t->uuid('operation_id')->primary();
            $t->uuid('assignment_id')->index();
            $t->uuid('account_id')->index();
            $t->char('contract_hash',64);
            $t->unsignedInteger('accepted_revision');
            $t->timestampTz('accepted_at');
        });
        Schema::create('assignment_history',function(Blueprint $t){
            $t->uuid('operation_id')->primary();
            $t->uuid('assignment_id')->index();$t->uuid('account_id')->index();
            $t->string('action',20);$t->string('from_status',20)->nullable();
            $t->string('to_status',20);$t->unsignedInteger('revision');
            $t->unsignedInteger('policy_revision');
            $t->longText('cipher_envelope');
            $t->timestampTz('accepted_at');
        });
        Schema::create('assignment_tombstones',function(Blueprint $t){
            $t->uuid('assignment_id')->primary();$t->uuid('account_id')->index();
            $t->unsignedInteger('revision');$t->timestampTz('deleted_at');
        });
    }
    public function down():void{
        Schema::dropIfExists('assignment_history');Schema::dropIfExists('assignment_operations');
        Schema::dropIfExists('assignment_tombstones');Schema::dropIfExists('assignments');
    }
};
