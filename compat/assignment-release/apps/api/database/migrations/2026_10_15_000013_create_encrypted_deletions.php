<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('encrypted_deletions', function (Blueprint $table): void {
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('vault_id')->constrained('workspace_vaults')->cascadeOnDelete();
            $table->uuid('photo_id');
            $table->unsignedBigInteger('expires_at')->index();
            $table->primary(['account_id', 'vault_id', 'photo_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('encrypted_deletions');
    }
};
