<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('identity_accounts', function (Blueprint $table): void {
            // UUID/public_id stay internal protocol identifiers. user_number is
            // the single human-facing, searchable eight-digit account ID.
            $table->unsignedInteger('user_number')->nullable()->unique();
        });

        Schema::create('identity_counters', function (Blueprint $table): void {
            $table->string('name', 40)->primary();
            $table->unsignedBigInteger('next_value');
        });

        $next = 10000000;
        foreach (DB::table('identity_accounts')->orderBy('created_at')->orderBy('id')->get(['id']) as $account) {
            DB::table('identity_accounts')->where('id', $account->id)->update(['user_number' => $next++]);
        }
        DB::table('identity_counters')->insert(['name' => 'user_number', 'next_value' => $next]);
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_counters');
        Schema::table('identity_accounts', function (Blueprint $table): void {
            $table->dropUnique(['user_number']);
            $table->dropColumn('user_number');
        });
    }
};
