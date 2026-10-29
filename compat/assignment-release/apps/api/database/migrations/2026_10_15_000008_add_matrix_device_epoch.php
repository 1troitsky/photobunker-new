<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('identity_devices', function (Blueprint $table): void {
            // Null preserves the original PB_<device UUID> binding for existing devices.
            $table->string('matrix_device_id', 128)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('identity_devices', fn (Blueprint $table) => $table->dropColumn('matrix_device_id'));
    }
};
