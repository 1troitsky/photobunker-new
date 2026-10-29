<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('photo_migration_checks', function (Blueprint $table): void {
            $table->foreignUuid('target_id')->primary()->constrained('encrypted_photos')->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->text('statement');
            $table->string('signature', 100);
            $table->timestamp('verified_at');
            $table->timestamp('cleaned_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('photo_migration_checks');
    }
};
