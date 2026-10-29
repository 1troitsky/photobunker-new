<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prototype_profiles', function (Blueprint $table): void {
            $table->uuid('library_id');
            $table->uuid('id');
            $table->primary(['library_id', 'id']);
            $table->foreign('library_id')->references('id')->on('prototype_libraries');
            $table->string('name', 80);
            $table->text('description');
            $table->unsignedInteger('version');
            $table->boolean('archived')->default(false);
        });
        Schema::create('prototype_profile_versions', function (Blueprint $table): void {
            $table->uuid('library_id');
            $table->uuid('profile_id');
            $table->unsignedInteger('version');
            $table->primary(['library_id', 'profile_id', 'version']);
            $table->json('snapshot');
        });
        Schema::table('prototype_photos', function (Blueprint $table): void {
            $table->uuid('profile_id')->nullable();
            $table->unsignedInteger('profile_version')->nullable();
            $table->json('profile_snapshot')->nullable();
            $table->string('short_id', 24)->nullable();
            $table->unique(['library_id', 'short_id']);
            $table->json('metadata')->nullable();
            $table->string('category', 80)->default('');
            $table->string('shot', 80)->default('');
        });
    }

    public function down(): void
    {
        Schema::table('prototype_photos', function (Blueprint $table): void {
            $table->dropUnique(['library_id', 'short_id']);
            $table->dropColumn(['profile_id', 'profile_version', 'profile_snapshot', 'short_id', 'metadata', 'category', 'shot']);
        });
        Schema::dropIfExists('prototype_profile_versions');
        Schema::dropIfExists('prototype_profiles');
    }
};
