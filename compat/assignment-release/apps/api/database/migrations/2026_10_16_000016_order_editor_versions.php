<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('encrypted_versions', function (Blueprint $t): void {
            $t->unsignedInteger('ordinal')->default(0);
        });
        foreach (DB::table('encrypted_versions')->distinct()->pluck('photo_id') as $photo) {
            $ordinal = 0;
            foreach (DB::table('encrypted_versions')->where('photo_id', $photo)->orderBy('created_at')->orderBy('id')->get() as $row) {
                DB::table('encrypted_versions')->where('id', $row->id)->update(['ordinal' => ++$ordinal]);
            }
        }
        Schema::table('encrypted_versions', fn (Blueprint $t) => $t->unique(['photo_id', 'ordinal']));
    }

    public function down(): void
    {
        Schema::table('encrypted_versions', function (Blueprint $t): void {
            $t->dropUnique(['photo_id', 'ordinal']);
            $t->dropColumn('ordinal');
        });
    }
};
