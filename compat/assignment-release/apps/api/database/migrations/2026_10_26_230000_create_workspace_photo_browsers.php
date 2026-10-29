<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspace_photo_browsers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('owner_id')->constrained('identity_accounts')->cascadeOnDelete();
            // Encrypted assignment IDs only. No originals, photo contents, notes or keys.
            $table->text('assignments');
            $table->unsignedBigInteger('expires_at')->index();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->index(['owner_id', 'revoked_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('workspace_photo_browsers');
    }
};
