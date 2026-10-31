<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('photo_name_allocator', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('next_prefix');
        });
        DB::table('photo_name_allocator')->insert(['id' => 1, 'next_prefix' => 0]);
        Schema::create('photo_name_prefixes', function (Blueprint $table) {
            $table->char('prefix', 4)->primary();
            $table->string('subject', 80)->index();
            $table->unsignedInteger('sequence');
            $table->unsignedInteger('next_number')->default(1);
            $table->unique('sequence');
        });
        Schema::create('photo_name_leases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('account_id');
            $table->uuid('device_id');
            $table->uuid('assignment_id')->nullable();
            $table->string('subject', 80);
            $table->char('prefix', 4);
            $table->unsignedInteger('first_number');
            $table->unsignedInteger('last_number');
            $table->uuid('request_key');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['account_id', 'device_id', 'request_key'], 'photo_name_lease_idempotency');
            $table->index(['account_id', 'device_id']);
        });
        Schema::create('photo_name_codes', function (Blueprint $table) {
            $table->uuid('photo_id')->primary();
            $table->char('code', 8)->unique();
            $table->uuid('creator_id');
            $table->uuid('device_id');
            $table->uuid('lease_id');
            $table->timestamp('created_at')->useCurrent();
            $table->index('creator_id');
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('photo_name_codes');
        Schema::dropIfExists('photo_name_leases');
        Schema::dropIfExists('photo_name_prefixes');
        Schema::dropIfExists('photo_name_allocator');
    }
};
