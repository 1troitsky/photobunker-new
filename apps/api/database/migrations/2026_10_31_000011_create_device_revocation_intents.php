<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Device revocation ACK survives session invalidation and lost HTTP responses. */
return new class extends Migration {
    public function up(): void {
        Schema::create('identity_device_revocation_intents', function (Blueprint $table): void {
            $table->uuid('operation_id')->primary();
            $table->uuid('account_id')->index();
            $table->uuid('device_id')->index();
            $table->string('intent', 32);
            $table->char('payload_hash', 64);
            $table->char('signature_hash', 64);
            $table->timestamp('committed_at');
            $table->timestamps();
            $table->foreign('account_id')->references('id')->on('identity_accounts')->cascadeOnDelete();
            $table->foreign('device_id')->references('id')->on('identity_devices')->cascadeOnDelete();
        });
    }
    public function down(): void { Schema::dropIfExists('identity_device_revocation_intents'); }
};
