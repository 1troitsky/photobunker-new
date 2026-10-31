<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('identity_sessions', function (Blueprint $table): void {
            $table->timestamp('expires_at')->nullable()->change();
        });
        DB::table('identity_sessions')->where('expires_at', '>', now())->update(['expires_at' => null]);
        Schema::table('identity_accounts', function (Blueprint $table): void {
            $table->string('username', 32)->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('identity_accounts', fn (Blueprint $table) => $table->dropColumn('username'));
        // Permanent sessions cannot be converted back to an arbitrary expiry.
    }
};
