<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('photo_keys', function (Blueprint $table): void {
            $table->foreignUuid('account_id')->primary()->constrained('identity_accounts')->cascadeOnDelete();
            $table->text('document');
            $table->text('bundle');
            $table->unsignedInteger('revision');
            $table->timestamps();
        });
        Schema::create('photo_devices', function (Blueprint $table): void {
            $table->foreignUuid('device_id')->primary()->constrained('identity_devices')->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->text('certificate');
            $table->timestamp('expires_at');
        });
        Schema::create('photo_read_challenges', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $table->char('session_hash', 64);
            $table->text('statement');
            $table->unsignedInteger('key_revision');
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
        });
        Schema::create('photo_read_sessions', function (Blueprint $table): void {
            $table->char('token_hash', 64)->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $table->char('session_hash', 64);
            $table->unsignedInteger('key_revision');
            $table->timestamp('expires_at');
        });
        Schema::table('workspace_vaults', function (Blueprint $table): void {
            $table->unsignedInteger('crypto_epoch')->default(0);
            $table->text('crypto_context')->nullable();
            $table->text('capture_plan')->nullable();
        });
        Schema::create('encrypted_photos', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('vault_id')->constrained('workspace_vaults')->cascadeOnDelete();
            $table->foreignUuid('creator_id')->constrained('identity_accounts');
            $table->uuid('assignment_id')->nullable()->index();
            $table->text('submission');
            $table->string('submission_signature', 100);
            $table->string('submission_hash', 43);
            $table->unsignedInteger('revision')->default(1);
            $table->unsignedInteger('review_revision')->default(1);
            $table->string('review_state', 16)->default('pending');
            $table->string('state', 16)->default('pending');
            $table->unsignedBigInteger('expires_at')->index();
            $table->timestamp('delete_verified_at')->nullable();
            $table->timestamps();
        });
        Schema::create('encrypted_objects', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('photo_id')->constrained('encrypted_photos')->cascadeOnDelete();
            $table->string('kind', 32);
            $table->unsignedInteger('revision');
            $table->unsignedBigInteger('bytes');
            $table->string('object_key');
            $table->text('packet');
            $table->text('event')->nullable();
            $table->string('event_signature', 100)->nullable();
            $table->timestamp('created_at');
            $table->index(['photo_id', 'kind', 'revision']);
        });
        Schema::create('photo_device_links', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $table->text('request');
            $table->text('response')->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
        });
    }

    public function down(): void
    {
        foreach (['photo_device_links', 'encrypted_objects', 'encrypted_photos'] as $name) {
            Schema::dropIfExists($name);
        }
        Schema::table('workspace_vaults', fn (Blueprint $table) => $table->dropColumn(['crypto_epoch', 'crypto_context', 'capture_plan']));
        foreach (['photo_read_sessions', 'photo_read_challenges', 'photo_devices', 'photo_keys'] as $name) {
            Schema::dropIfExists($name);
        }
    }
};
