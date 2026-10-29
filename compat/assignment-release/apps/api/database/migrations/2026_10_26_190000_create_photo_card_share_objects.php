<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('photo_card_share_objects', function (Blueprint $table): void {
            $table->foreignUuid('share_id')->constrained('encrypted_shares')->cascadeOnDelete();
            $table->string('kind', 16);
            $table->foreignUuid('object_id')->unique()->constrained('encrypted_objects')->cascadeOnDelete();
            $table->primary(['share_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('photo_card_share_objects');
    }
};
