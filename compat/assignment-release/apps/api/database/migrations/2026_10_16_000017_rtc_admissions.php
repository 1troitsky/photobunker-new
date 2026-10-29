<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rtc_admissions', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $t->foreignUuid('device_id')->constrained('identity_devices')->cascadeOnDelete();
            $t->char('session_hash', 64);
            $t->string('room_id', 255);
            $t->string('sfu_room', 255);
            $t->string('participant', 255);
            $t->timestamp('created_at');
            $t->timestamp('expires_at');
            $t->timestamp('ended_at')->nullable();
            $t->timestamp('removed_at')->nullable();
            $t->timestamp('checked_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rtc_admissions');
    }
};
