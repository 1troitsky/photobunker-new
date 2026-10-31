<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_emergency_keys', function (Blueprint $t): void {
            $t->uuid('key_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $t->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $t->unsignedInteger('revision');
            $t->text('public_key');
            $t->uuid('operation_id')->unique();
            $t->timestamp('created_at');
            $t->timestamp('revoked_at')->nullable();
            $t->unique(['account_id', 'device_id', 'revision'], 'emergency_key_scope_revision');
            $t->index(['account_id', 'device_id', 'revoked_at'], 'emergency_key_active_lookup');
        });
        Schema::create('identity_emergency_operations', function (Blueprint $t): void {
            $t->uuid('operation_id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $t->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $t->uuid('key_id');
            $t->string('action', 16);
            $t->unsignedInteger('revision');
            $t->string('payload_hash', 64);
            $t->timestamp('created_at');
        });
        // Intentionally no FK to identity_accounts: final account deletion must
        // NOT erase the immutable retry receipt for a lost-ACK intent.
        Schema::create('identity_emergency_receipts', function (Blueprint $t): void {
            $t->uuid('operation_id')->primary();
            $t->uuid('account_id')->index();
            $t->uuid('device_id');
            $t->uuid('key_id');
            $t->unsignedInteger('revision');
            $t->string('payload_hash', 64);
            $t->string('signature_hash', 64);
            $t->text('public_key');
            $t->timestamp('accepted_at');
            $t->timestamp('completed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_emergency_receipts');
        Schema::dropIfExists('identity_emergency_operations');
        Schema::dropIfExists('identity_emergency_keys');
    }
};
