<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // An intentional card revoke must win over a lost create ACK. This
        // tiny negative ledger is never reused to publish a different share.
        Schema::create('photo_card_share_tombstones', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('photo_id')->index();
            $table->uuid('creator_id');
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('photo_card_share_tombstones');
    }
};
