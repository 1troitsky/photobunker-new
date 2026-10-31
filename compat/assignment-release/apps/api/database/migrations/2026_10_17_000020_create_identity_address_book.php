<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_address_book', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('account_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->foreignUuid('contact_id')->constrained('identity_accounts')->cascadeOnDelete();
            $table->timestamp('created_at');
            $table->unique(['account_id', 'contact_id']);
        });
        DB::table('identity_contacts')->where('state', 'accepted')->orderBy('id')->chunk(100, function ($rows): void {
            foreach ($rows as $row) {
                foreach ([[$row->requester, $row->recipient], [$row->recipient, $row->requester]] as [$owner, $contact]) {
                    DB::table('identity_address_book')->insertOrIgnore(['id' => (string) Str::uuid(), 'account_id' => $owner, 'contact_id' => $contact, 'created_at' => $row->created_at]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_address_book');
    }
};
