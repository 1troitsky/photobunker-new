<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prototype_deletions', function (Blueprint $table): void {
            $table->uuid('library_id');
            $table->uuid('id');
            $table->primary(['library_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prototype_deletions');
    }
};
