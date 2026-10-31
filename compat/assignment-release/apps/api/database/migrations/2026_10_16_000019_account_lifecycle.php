<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('identity_accounts', function (Blueprint $t): void {
            $t->unsignedSmallInteger('inactivity_days')->default(180);
            $t->timestamp('last_active_at')->useCurrent();
            $t->timestamp('inactivity_delete_at')->nullable()->index();
            $t->timestamp('deletion_requested_at')->nullable()->index();
            $t->string('deletion_reason', 16)->nullable();
            $t->unsignedInteger('deletion_attempts')->default(0);
            $t->timestamp('deletion_retry_at')->nullable();
            $t->timestamp('matrix_erased_at')->nullable();
        });
        // Existing installations receive a full notice period from this upgrade.
        DB::table('identity_accounts')->update(['last_active_at' => now(), 'inactivity_delete_at' => now()->addDays(180)]);
    }

    public function down(): void
    {
        Schema::table('identity_accounts', fn (Blueprint $t) => $t->dropColumn(['inactivity_days', 'last_active_at', 'inactivity_delete_at', 'deletion_requested_at', 'deletion_reason', 'deletion_attempts', 'deletion_retry_at', 'matrix_erased_at']));
    }
};
