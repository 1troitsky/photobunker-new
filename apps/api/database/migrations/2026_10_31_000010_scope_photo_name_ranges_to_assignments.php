<?php
declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Preserve existing global IDs and leases. New assignment-scoped ranges remain globally unique. */
return new class extends Migration {
    public function up():void {
        Schema::table('photo_name_prefixes',function(Blueprint $t){
            $t->uuid('assignment_id')->nullable()->index();
        });
        Schema::table('photo_name_leases',function(Blueprint $t){
            $t->uuid('assignment_id')->nullable()->index();
        });
    }
    public function down():void {
        Schema::table('photo_name_leases',fn(Blueprint $t)=>$t->dropColumn('assignment_id'));
        Schema::table('photo_name_prefixes',fn(Blueprint $t)=>$t->dropColumn('assignment_id'));
    }
};
