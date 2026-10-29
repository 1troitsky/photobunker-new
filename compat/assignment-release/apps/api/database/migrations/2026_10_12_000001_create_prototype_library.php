<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prototype_libraries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('created_at');
        });
        Schema::create('prototype_photos', function (Blueprint $table): void {
            $table->uuid('library_id');
            $table->uuid('id');
            $table->primary(['library_id', 'id']);
            $table->foreign('library_id')->references('id')->on('prototype_libraries');
            $table->string('state', 16)->index();
            $table->string('original_key');
            $table->string('thumbnail_key');
            $table->char('fingerprint', 64);
            $table->unsignedBigInteger('bytes');
            $table->unsignedBigInteger('thumbnail_bytes');
            $table->unsignedBigInteger('captured_at');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->string('mime', 32);
            $table->string('method', 20);
            $table->string('title', 120)->default('');
            $table->text('note');
            $table->boolean('favorite')->default(false);
            $table->unsignedInteger('revision')->default(1);
            $table->timestamp('created_at');
            $table->timestamp('delete_verified_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prototype_photos');
        Schema::dropIfExists('prototype_libraries');
    }
};
