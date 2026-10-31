<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('photo_recovery_checks',function(Blueprint $table): void {
            $table->uuid('operation_id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('photo_id')->constrained('photo_records')->cascadeOnDelete();
            $table->foreignUuid('asset_id')->constrained('photo_objects')->cascadeOnDelete();
            $table->foreignUuid('origin_device_id')->constrained('identity_devices')->cascadeOnDelete();
            $table->foreignUuid('verifier_device_id')->constrained('identity_devices');
            $table->char('cipher_sha256',64);
            $table->string('decryption',20);
            $table->char('payload_hash',64);
            $table->char('signature_hash',64);
            $table->timestampTz('verified_at');
            $table->timestampsTz();
            $table->unique(['asset_id','verifier_device_id']);
            $table->index(['account_id','photo_id']);
        });
    }
    public function down():void {Schema::dropIfExists('photo_recovery_checks');}
};
