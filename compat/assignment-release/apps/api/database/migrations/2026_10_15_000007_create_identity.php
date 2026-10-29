<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('public_id', 32)->unique();
            $table->string('key_fingerprint', 64)->unique();
            $table->text('public_key');
            $table->text('profile');
            $table->unsignedInteger('revision')->default(1);
            $table->text('matrix_password');
            $table->string('matrix_state', 24)->default('pending');
            $table->timestamps();
        });
        Schema::create('identity_devices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->text('public_key');
            $table->string('name', 80);
            $table->timestamp('revoked_at')->nullable();
            $table->boolean('matrix_revoke_pending')->default(false);
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();
        });
        Schema::create('identity_sessions', function (Blueprint $table): void {
            $table->string('token_hash', 64)->primary();
            $table->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('created_at');
        });
        Schema::create('identity_challenges', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('purpose', 16);
            $table->text('payload');
            $table->text('message');
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
        });
        Schema::create('identity_contacts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('requester')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('recipient')->constrained('identity_accounts')->cascadeOnDelete();
            $table->string('pair_key', 73)->unique();
            $table->string('state', 16);
            $table->timestamps();
        });
        Schema::create('identity_blocks', function (Blueprint $table): void {
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('blocked_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->timestamp('created_at');
            $table->primary(['account_id', 'blocked_id']);
        });
        Schema::create('identity_legacy_claims', function (Blueprint $table): void {
            $table->uuid('library_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        foreach (['identity_legacy_claims', 'identity_blocks', 'identity_contacts', 'identity_challenges', 'identity_sessions', 'identity_devices', 'identity_accounts'] as $name) {
            Schema::dropIfExists($name);
        }
    }
};
