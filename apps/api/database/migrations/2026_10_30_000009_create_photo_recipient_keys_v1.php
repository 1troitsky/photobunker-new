<?php
declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up():void {
        Schema::create('photo_recipient_keys_v1',function(Blueprint $t){
            $t->foreignUuid('grant_id')->constrained('assignment_grants_v1')->cascadeOnDelete();
            $t->unsignedInteger('generation');
            $t->foreignUuid('photo_id')->constrained('photo_records')->cascadeOnDelete();
            $t->foreignUuid('asset_id')->constrained('photo_objects')->cascadeOnDelete();
            $t->foreignUuid('owner_account_id')->constrained('identity_accounts');
            $t->foreignUuid('recipient_account_id')->constrained('identity_accounts');
            $t->uuid('operation_id')->unique();
            $t->char('contract_hash',64);$t->longText('contract_json');
            $t->text('signature');$t->text('signer_spki');
            $t->foreignUuid('publisher_device_id')->constrained('identity_devices');
            $t->text('owner_root_signature');
            $t->timestampTz('created_at');
            $t->primary(['grant_id','generation','photo_id','asset_id'],'photo_share_key_pk');
            $t->index(['recipient_account_id','photo_id']);
        });
    }
    public function down():void {
        Schema::dropIfExists('photo_recipient_keys_v1');
    }
};
