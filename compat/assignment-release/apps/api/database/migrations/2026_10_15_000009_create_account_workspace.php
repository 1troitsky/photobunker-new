<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspace_records', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('owner_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->string('kind', 16);
            $table->unsignedInteger('revision');
            $table->text('payload'); // Local prototype: APP_KEY at rest, photo E2EE is B04.
            $table->uuid('team_id')->nullable();
            $table->string('room_id', 255)->nullable()->unique();
            $table->string('room_state', 16)->default('none');
            $table->timestamp('room_retry_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
            $table->index(['owner_id', 'kind']);
        });
        Schema::create('workspace_record_versions', function (Blueprint $table): void {
            $table->foreignUuid('record_id')->constrained('workspace_records')->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->text('payload');
            $table->primary(['record_id', 'revision']);
        });
        Schema::create('workspace_members', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('record_id')->constrained('workspace_records')->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->string('role', 16);
            $table->string('photo_scope', 16)->default('default');
            $table->string('state', 16);
            $table->unsignedBigInteger('expires_at');
            $table->unique(['record_id', 'account_id']);
        });
        Schema::create('workspace_vaults', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('owner_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->uuid('assignment_id')->nullable()->unique();
            $table->string('kind', 16);
        });
        Schema::create('workspace_clock_anchors', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->unsignedBigInteger('issued_at');
        });
        Schema::create('workspace_photos', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('vault_id')->constrained('workspace_vaults')->cascadeOnDelete();
            $table->uuid('creator_id');
            $table->uuid('assignment_id')->nullable()->index();
            $table->text('manifest');
            $table->string('state', 16);
            $table->string('original_key');
            $table->string('thumbnail_key');
            $table->unsignedBigInteger('bytes');
            $table->unsignedBigInteger('thumbnail_bytes');
            $table->string('fingerprint', 64);
            $table->unsignedInteger('revision');
            $table->unsignedBigInteger('expires_at')->index();
            $table->timestamp('delete_verified_at')->nullable();
            $table->timestamp('created_at');
        });
        Schema::create('workspace_imports', function (Blueprint $table): void {
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->string('source_hash', 64);
            $table->uuid('target_id');
            $table->primary(['account_id', 'source_hash']);
        });
    }

    public function down(): void
    {
        foreach (['workspace_imports', 'workspace_photos', 'workspace_clock_anchors', 'workspace_vaults', 'workspace_members', 'workspace_record_versions', 'workspace_records'] as $name) {
            Schema::dropIfExists($name);
        }
    }
};
