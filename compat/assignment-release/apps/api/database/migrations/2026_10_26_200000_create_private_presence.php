<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_presence_preferences', function (Blueprint $table): void {
            $table->foreignUuid('account_id')->primary()->constrained('identity_accounts')->cascadeOnDelete();
            $table->string('visibility', 12)->default('contacts');
            $table->unsignedBigInteger('revision')->default(0);
            $table->uuid('operation_id')->nullable();
            // Server-only. Never expose timestamps from presence endpoints.
            $table->timestamp('last_active_at')->nullable();
        });
        Schema::create('identity_presence_leases', function (Blueprint $table): void {
            $table->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $table->uuid('instance_id'); // Ephemeral per browser tab/load, not reusable after close.
            $table->unsignedBigInteger('sequence');
            $table->timestamp('last_pulse_at');
            $table->timestamp('closed_at')->nullable();
            $table->primary(['device_id', 'instance_id']);
            $table->index(['closed_at', 'last_pulse_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_presence_leases');
        Schema::dropIfExists('identity_presence_preferences');
    }
};
