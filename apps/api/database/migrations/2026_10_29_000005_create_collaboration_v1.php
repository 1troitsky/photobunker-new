<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('contact_links_v1', function (Blueprint $t) {
            $t->foreignUuid('left_account_id')->constrained('identity_accounts');
            $t->foreignUuid('right_account_id')->constrained('identity_accounts');
            $t->foreignUuid('requester_id')->constrained('identity_accounts');
            $t->string('state', 12); $t->timestampsTz();
            $t->primary(['left_account_id','right_account_id']);
        });
        Schema::create('contact_blocks_v1', function (Blueprint $t) {
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->foreignUuid('blocked_account_id')->constrained('identity_accounts');
            $t->timestampTz('created_at');
            $t->primary(['account_id','blocked_account_id']);
        });
        Schema::create('teams_v1', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->unsignedInteger('revision');
            // Ciphertext-only. Never store team name, description or avatar in clear.
            $t->longText('profile_cipher');
            $t->timestampsTz();
            $t->index(['owner_account_id','updated_at']);
        });
        Schema::create('team_members_v1', function (Blueprint $t) {
            $t->uuid('team_id'); $t->foreign('team_id')->references('id')->on('teams_v1')->cascadeOnDelete();
            $t->foreignUuid('account_id')->constrained('identity_accounts');
            $t->string('role', 12); $t->timestampTz('joined_at');
            $t->timestampTz('revoked_at')->nullable();
            $t->primary(['team_id','account_id']);
            $t->index(['account_id','revoked_at']);
        });
        Schema::create('team_invitations_v1', function (Blueprint $t) {
            $t->uuid('id')->primary(); $t->uuid('team_id');
            $t->foreign('team_id')->references('id')->on('teams_v1')->cascadeOnDelete();
            $t->foreignUuid('inviter_account_id')->constrained('identity_accounts');
            $t->foreignUuid('target_account_id')->constrained('identity_accounts');
            $t->string('role',12); $t->char('code_hash',64);
            // Wrapped group key, not the invitation secret.
            $t->text('sealed_key');
            $t->string('state',12); $t->timestampTz('expires_at');
            $t->timestampsTz(); $t->index(['target_account_id','state','expires_at']);
            $t->index(['team_id','target_account_id','state']);
        });
        Schema::create('collaboration_operations_v1', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('actor_account_id')->constrained('identity_accounts');
            $t->char('contract_hash',64);
            $t->text('receipt');
            $t->timestampTz('created_at');
        });
    }

    public function down(): void {
        Schema::dropIfExists('collaboration_operations_v1');
        Schema::dropIfExists('team_invitations_v1');
        Schema::dropIfExists('team_members_v1');
        Schema::dropIfExists('teams_v1');
        Schema::dropIfExists('contact_blocks_v1');
        Schema::dropIfExists('contact_links_v1');
    }
};
