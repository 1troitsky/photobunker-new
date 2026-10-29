<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prototype_spaces', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('owner_id')->index();
            $table->string('name', 80);
        });
        Schema::create('prototype_members', function (Blueprint $table): void {
            $table->uuid('space_id');
            $table->uuid('actor_id');
            $table->primary(['space_id', 'actor_id']);
            $table->string('role', 20);
            $table->string('nickname', 80);
            $table->boolean('read_own')->default(false);
            $table->boolean('manage_profiles')->default(false);
            $table->boolean('active')->default(true);
            $table->uuid('invitation_id')->nullable();
        });
        Schema::create('prototype_invitations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('space_id')->index();
            $table->string('token_hash', 64)->unique();
            $table->string('role', 20);
            $table->boolean('read_own');
            $table->boolean('manage_profiles');
            $table->unsignedBigInteger('expires_at');
            $table->uuid('accepted_by')->nullable();
            $table->boolean('revoked')->default(false);
        });
        Schema::table('prototype_profiles', fn (Blueprint $table) => $table->uuid('space_id')->nullable()->index());
        Schema::create('prototype_assignments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('space_id')->index();
            $table->uuid('profile_id');
            $table->json('profile_snapshot');
            $table->string('name', 80);
            $table->text('instructions');
            $table->json('assignees');
            $table->json('shots');
            $table->unsignedBigInteger('due_at')->nullable();
            $table->boolean('closed')->default(false);
            $table->unsignedInteger('revision')->default(1);
        });
        Schema::table('prototype_photos', function (Blueprint $table): void {
            $table->uuid('space_id')->nullable()->index();
            $table->uuid('creator_id')->nullable()->index();
            $table->uuid('assignment_id')->nullable()->index();
            $table->uuid('replaces_id')->nullable();
            $table->string('review_state', 20)->default('pending');
            $table->unsignedInteger('review_revision')->default(1);
            $table->text('review_comment')->nullable();
            $table->text('response_comment')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('prototype_photos', fn (Blueprint $table) => $table->dropColumn(['space_id', 'creator_id', 'assignment_id', 'replaces_id', 'review_state', 'review_revision', 'review_comment', 'response_comment']));
        Schema::dropIfExists('prototype_assignments');
        Schema::table('prototype_profiles', fn (Blueprint $table) => $table->dropColumn('space_id'));
        Schema::dropIfExists('prototype_invitations');
        Schema::dropIfExists('prototype_members');
        Schema::dropIfExists('prototype_spaces');
    }
};
