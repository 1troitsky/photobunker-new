<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_recovery_bundles', function (Blueprint $table): void {
            $table->foreignUuid('account_id')->primary()->constrained('identity_accounts')->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->text('document');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_recovery_bundles');
    }
};
