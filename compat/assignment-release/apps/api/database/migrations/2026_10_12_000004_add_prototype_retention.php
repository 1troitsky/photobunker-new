<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prototype_clock_anchors', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('library_id')->index();
            $table->unsignedBigInteger('issued_at');
        });
        Schema::table('prototype_photos', function (Blueprint $table): void {
            $table->unsignedBigInteger('expires_at')->nullable()->index();
            $table->uuid('retention_anchor')->nullable();
            $table->unsignedInteger('retention_seconds')->nullable();
            $table->unsignedInteger('delete_attempts')->default(0);
            $table->timestamp('delete_retry_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('prototype_photos', fn (Blueprint $table) => $table->dropColumn(['expires_at', 'retention_anchor', 'retention_seconds', 'delete_attempts', 'delete_retry_at']));
        Schema::dropIfExists('prototype_clock_anchors');
    }
};
