<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('encrypted_versions', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('photo_id')->constrained('encrypted_photos')->cascadeOnDelete();
            $t->foreignUuid('image_id')->constrained('encrypted_objects');
            $t->foreignUuid('metadata_id')->constrained('encrypted_objects');
            $t->foreignUuid('creator_id')->constrained('identity_accounts');
            $t->text('event');
            $t->string('signature', 100);
            $t->boolean('conflict');
            $t->timestamp('created_at');
        });
        Schema::create('encrypted_shares', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('photo_id')->constrained('encrypted_photos')->cascadeOnDelete();
            $t->foreignUuid('object_id')->constrained('encrypted_objects');
            $t->foreignUuid('creator_id')->constrained('identity_accounts');
            $t->text('manifest');
            $t->unsignedBigInteger('expires_at')->index();
            $t->timestamp('revoked_at')->nullable();
            $t->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('encrypted_shares');
        Schema::dropIfExists('encrypted_versions');
    }
};
