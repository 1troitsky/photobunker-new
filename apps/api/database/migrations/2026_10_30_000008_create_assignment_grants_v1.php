<?php
declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void {
        Schema::create('assignment_grants_v1',function(Blueprint $t){
            $t->uuid('id')->primary();
            $t->foreignUuid('assignment_id')->constrained('assignments')->cascadeOnDelete();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->string('role',12);$t->string('state',12); // pending|accepted|declined|revoked
            $t->unsignedInteger('generation')->default(1);
            $t->char('code_hash',64);$t->text('sealed_key');
            $t->unsignedBigInteger('invite_expires_at'); // unix ms; accepted grant does not reset photo TTL
            $t->timestampTz('accepted_at')->nullable();
            $t->timestampTz('revoked_at')->nullable();
            $t->timestampsTz();
            $t->index(['assignment_id','recipient_account_id','state']);
            $t->index(['recipient_account_id','state','invite_expires_at']);
        });
        Schema::create('assignment_grant_operations_v1',function(Blueprint $t){
            $t->uuid('id')->primary();
            $t->foreignUuid('actor_account_id')->constrained('identity_accounts');
            $t->char('contract_hash',64);$t->text('receipt');$t->timestampTz('created_at');
        });
    }
    public function down():void {
        Schema::dropIfExists('assignment_grant_operations_v1');
        Schema::dropIfExists('assignment_grants_v1');
    }
};
