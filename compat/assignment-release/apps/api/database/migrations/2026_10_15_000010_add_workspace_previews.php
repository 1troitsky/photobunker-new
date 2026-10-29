<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('workspace_photos', function (Blueprint $table): void {
            $table->string('preview_key')->nullable();
            $table->unsignedBigInteger('preview_bytes')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('workspace_photos', fn (Blueprint $table) => $table->dropColumn(['preview_key', 'preview_bytes']));
    }
};
