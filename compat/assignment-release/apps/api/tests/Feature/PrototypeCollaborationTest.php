<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PrototypeCollaborationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['prototype.enabled' => true]);
        Storage::fake('s3');
    }

    private function actor(): array
    {
        $data = $this->postJson('/api/v1/prototype/libraries')->assertCreated()->json();

        return ['id' => $data['libraryId'], 'headers' => ['Authorization' => 'Bearer '.$data['accessCode']]];
    }

    private function profile(array $owner): array
    {
        $rules = ['retentionSeconds' => 3600, 'resolution' => 'maximum', 'width' => 1600, 'height' => 1200, 'aspect' => 'native', 'aspectWidth' => 4, 'aspectHeight' => 3,
            'fit' => 'crop', 'quality' => 0.94, 'metadata' => 'none', 'keepDate' => false, 'keepCamera' => false, 'location' => 'off', 'accuracy' => 20, 'locationWindow' => 15,
            'descriptionRequired' => true, 'descriptionEditable' => true, 'categoryRequired' => false, 'categories' => [], 'shotList' => ['Фасад'], 'idPrefix' => 'TEAM'];

        return $this->putJson('/api/v1/prototype/profiles/'.Str::uuid(), ['name' => 'Synthetic profile', 'description' => '', 'version' => 0, 'archived' => false, 'rules' => $rules], $owner['headers'])->assertOk()->json('profile');
    }

    private function share(array $owner, array $profile): array
    {
        return $this->postJson('/api/v1/prototype/profiles/'.$profile['id'].'/space', ['version' => $profile['version']], $owner['headers'])->assertOk()->json('profile');
    }

    private function invite(array $owner, array $profile, string $role = 'contributor', bool $read = false, bool $manage = false): array
    {
        return $this->postJson('/api/v1/prototype/spaces/'.$profile['spaceId'].'/invitations', ['role' => $role, 'readOwnPhotos' => $read, 'manageProfiles' => $manage, 'duration' => 3600], $owner['headers'])->assertCreated()->json();
    }

    private function join(array $owner, array $profile, array $member, string $role = 'contributor', bool $read = false): array
    {
        $invite = $this->invite($owner, $profile, $role, $read);
        $this->postJson('/api/v1/prototype/invitations/accept', ['code' => $invite['code'], 'nickname' => 'Synthetic participant'], $member['headers'])->assertOk();

        return $invite;
    }

    private function manifest(array $actor, array $profile, array $extra = []): array
    {
        $anchor = $this->postJson('/api/v1/prototype/clock', [], $actor['headers'])->assertOk()->json();

        return ['id' => (string) Str::uuid(), 'createdAt' => $anchor['issuedAt'], 'width' => 800, 'height' => 600, 'mime' => 'image/jpeg', 'method' => 'demo',
            'title' => '', 'note' => '', 'favorite' => false, 'profile' => $profile, 'metadata' => [], 'shortId' => 'TEAM-'.strtoupper(Str::random(10)),
            'shot' => 'Фасад', 'retentionAnchor' => $anchor['id'], 'retentionSeconds' => 3600, ...$extra];
    }

    private function upload(array $actor, array $manifest)
    {
        return $this->post('/api/v1/prototype/photos', ['manifest' => json_encode($manifest),
            'original' => UploadedFile::fake()->createWithContent('original', 'synthetic-original'),
            'thumbnail' => UploadedFile::fake()->createWithContent('thumbnail', 'synthetic-thumbnail')], $actor['headers']);
    }

    private function assignment(array $owner, array $profile, array $member): array
    {
        return $this->postJson('/api/v1/prototype/assignments', ['profileId' => $profile['id'], 'name' => 'Synthetic task', 'instructions' => 'Synthetic instructions',
            'assignees' => [$member['id']], 'shots' => ['Вход'], 'dueAt' => now()->addDay()->getTimestampMs()], $owner['headers'])->assertCreated()->json('assignment');
    }

    public function test_invitation_is_hashed_single_use_idempotent_for_recipient_and_revocable(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $other = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $invite = $this->invite($owner, $profile);
        $body = ['code' => $invite['code'], 'nickname' => 'Recipient'];
        $this->assertDatabaseHas('prototype_invitations', ['token_hash' => hash('sha256', $invite['code'])]);
        $this->assertDatabaseMissing('prototype_invitations', ['token_hash' => $invite['code']]);
        $this->postJson('/api/v1/prototype/invitations/accept', $body, $member['headers'])->assertOk();
        $this->postJson('/api/v1/prototype/invitations/accept', $body, $member['headers'])->assertOk();
        $this->postJson('/api/v1/prototype/invitations/accept', $body, $other['headers'])->assertConflict();
        $this->getJson('/api/v1/prototype/profiles', $member['headers'])->assertJsonCount(1, 'profiles')->assertJsonPath('profiles.0.access.role', 'contributor');
        $this->getJson('/api/v1/prototype/profiles', $other['headers'])->assertJsonCount(0, 'profiles');
        $this->deleteJson('/api/v1/prototype/invitations/'.$invite['id'], [], $owner['headers'])->assertOk();
        $this->getJson('/api/v1/prototype/profiles', $member['headers'])->assertJsonCount(0, 'profiles');
        $this->postJson('/api/v1/prototype/invitations/accept', $body, $member['headers'])->assertGone();
        $expired = $this->invite($owner, $profile);
        $this->travel(1)->hours();
        $this->postJson('/api/v1/prototype/invitations/accept', ['code' => $expired['code'], 'nickname' => 'Recipient'], $other['headers'])->assertGone();
    }

    public function test_upload_only_contributor_cannot_read_own_or_other_photos_but_owner_receives_them(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $other = $this->actor();
        $private = $this->profile($owner);
        $old = $this->manifest($owner, $private);
        $this->upload($owner, $old)->assertOk();
        $shared = $this->share($owner, $private);
        $this->join($owner, $shared, $member);
        $this->join($owner, $shared, $other, 'contributor', true);
        $own = $this->manifest($member, $shared);
        $this->upload($member, $own)->assertOk()->assertJsonPath('photo.uploadOnly', true)->assertJsonPath('photo.remoteLibraryId', $member['id']);
        $this->upload($member, $own)->assertOk();
        $this->assertDatabaseHas('prototype_photos', ['id' => $own['id'], 'library_id' => $owner['id'], 'creator_id' => $member['id']]);
        foreach (['', '/original', '/thumbnail'] as $suffix) {
            $this->getJson('/api/v1/prototype/photos/'.$own['id'].$suffix, $member['headers'])->assertForbidden();
            $this->getJson('/api/v1/prototype/photos/'.$own['id'].$suffix, $other['headers'])->assertForbidden();
        }
        $this->getJson('/api/v1/prototype/photos', $member['headers'])->assertJsonCount(0, 'photos');
        $this->getJson('/api/v1/prototype/photos', $owner['headers'])->assertJsonCount(2, 'photos');
        $this->getJson('/api/v1/prototype/photos/'.$old['id'], $member['headers'])->assertNotFound();
        $this->upload($member, $this->manifest($member, $private))->assertForbidden();
        $this->assertDatabaseCount('prototype_photos', 2);
    }

    public function test_viewer_and_curator_have_distinct_permissions_and_profile_delegation_is_explicit(): void
    {
        $owner = $this->actor();
        $viewer = $this->actor();
        $curator = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $viewer, 'viewer');
        $invite = $this->join($owner, $profile, $curator, 'curator');
        $photo = $this->manifest($owner, $profile);
        $this->upload($owner, $photo)->assertOk();
        $path = '/api/v1/prototype/photos/'.$photo['id'];
        $this->getJson($path.'/original', $viewer['headers'])->assertOk();
        $this->patchJson($path, ['title' => '', 'note' => 'Forbidden', 'favorite' => false, 'revision' => 1], $viewer['headers'])->assertForbidden();
        $this->deleteJson($path, [], $viewer['headers'])->assertForbidden();
        $this->upload($viewer, $this->manifest($viewer, $profile))->assertForbidden();
        $this->postJson($path.'/review', ['state' => 'accepted', 'comment' => '', 'revision' => 1], $viewer['headers'])->assertForbidden();
        $this->putJson('/api/v1/prototype/profiles/'.$profile['id'], [...$profile, 'archived' => false], $curator['headers'])->assertForbidden();
        $this->postJson('/api/v1/prototype/spaces/'.$profile['spaceId'].'/invitations', ['role' => 'viewer', 'readOwnPhotos' => true, 'manageProfiles' => false, 'duration' => 3600], $curator['headers'])->assertForbidden();
        $this->patchJson('/api/v1/prototype/spaces/'.$profile['spaceId'].'/members/'.$curator['id'], ['active' => true, 'readOwnPhotos' => true, 'manageProfiles' => true], $owner['headers'])->assertOk();
        $this->putJson('/api/v1/prototype/profiles/'.$profile['id'], [...$profile, 'archived' => false], $curator['headers'])->assertOk();
        $this->postJson($path.'/review', ['state' => 'accepted', 'comment' => '', 'revision' => 1], $curator['headers'])->assertOk();
    }

    public function test_assignments_bind_snapshot_shots_and_assignees_and_hide_other_tasks(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $other = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $member);
        $this->join($owner, $profile, $other);
        $task = $this->assignment($owner, $profile, $member);
        $this->getJson('/api/v1/prototype/assignments', $other['headers'])->assertJsonCount(0, 'assignments');
        $this->getJson('/api/v1/prototype/assignments/'.$task['id'], $other['headers'])->assertForbidden();
        $data = $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']);
        $this->upload($member, $data)->assertOk();
        $this->upload($other, $this->manifest($other, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']))->assertForbidden();
        $new = $this->putJson('/api/v1/prototype/profiles/'.$profile['id'], [...$profile, 'archived' => false, 'name' => 'Changed rules'], $owner['headers'])->assertOk()->json('profile');
        $this->upload($member, $this->manifest($member, $new, ['assignmentId' => $task['id'], 'shot' => 'Вход']))->assertUnprocessable();
        $this->upload($member, $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']))->assertOk();
        $this->getJson('/api/v1/prototype/assignments/'.$task['id'], $member['headers'])->assertJsonCount(2, 'submissions')->assertJsonPath('submissions.0.canRead', false)->assertJsonMissingPath('submissions.0.note')->assertJsonMissingPath('submissions.0.metadata');
        $this->patchJson('/api/v1/prototype/assignments/'.$task['id'], ['closed' => true, 'revision' => 1], $owner['headers'])->assertOk();
        $this->upload($member, $data)->assertOk()->assertJsonPath('photo.id', $data['id']);
        $this->upload($member, $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']))->assertForbidden();
    }

    public function test_review_correction_response_and_reshoot_preserve_original_and_revisions(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $member);
        $task = $this->assignment($owner, $profile, $member);
        $data = $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']);
        $this->upload($member, $data)->assertOk();
        $path = '/api/v1/prototype/photos/'.$data['id'];
        $this->postJson($path.'/review', ['state' => 'correction', 'comment' => 'Add a note', 'revision' => 1], $owner['headers'])->assertOk();
        $this->postJson($path.'/review', ['state' => 'accepted', 'comment' => '', 'revision' => 1], $owner['headers'])->assertConflict();
        $this->postJson($path.'/response', ['comment' => 'Completed', 'note' => 'Synthetic description', 'revision' => 2], $member['headers'])->assertOk();
        $this->getJson($path, $owner['headers'])->assertJsonPath('photo.note', 'Synthetic description')->assertJsonPath('photo.reviewState', 'pending');
        $this->postJson($path.'/review', ['state' => 'reshoot', 'comment' => 'Retake closer', 'revision' => 3], $owner['headers'])->assertOk();
        $replacement = $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход', 'replacesId' => $data['id']]);
        $this->upload($member, $replacement)->assertOk()->assertJsonPath('photo.replacesId', $data['id']);
        $this->get('/api/v1/prototype/photos/'.$data['id'].'/original', $owner['headers'])->assertOk();
        $this->assertDatabaseCount('prototype_photos', 2);
        $this->assertCount(4, Storage::disk('s3')->allFiles());
        $this->postJson($path.'/review', ['state' => 'accepted', 'comment' => '', 'revision' => 4], $owner['headers'])->assertOk();
        $this->upload($member, $replacement)->assertOk()->assertJsonPath('photo.id', $replacement['id']);
        $this->postJson('/api/v1/prototype/photos/'.$replacement['id'].'/review', ['state' => 'accepted', 'comment' => '', 'revision' => 1], $owner['headers'])->assertOk();
    }

    public function test_revocation_stops_reads_uploads_and_assignment_feedback_immediately(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $member, 'contributor', true);
        $task = $this->assignment($owner, $profile, $member);
        $photo = $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']);
        $this->upload($member, $photo)->assertOk();
        $this->getJson('/api/v1/prototype/photos/'.$photo['id'], $member['headers'])->assertOk();
        $this->patchJson('/api/v1/prototype/spaces/'.$profile['spaceId'].'/members/'.$member['id'], ['active' => false, 'readOwnPhotos' => true, 'manageProfiles' => false], $owner['headers'])->assertOk();
        $this->getJson('/api/v1/prototype/photos/'.$photo['id'], $member['headers'])->assertNotFound();
        $this->getJson('/api/v1/prototype/assignments/'.$task['id'], $member['headers'])->assertForbidden();
        $this->upload($member, $this->manifest($member, $profile))->assertUnprocessable();
        $this->getJson('/api/v1/prototype/photos', $member['headers'])->assertJsonCount(0, 'photos');
    }

    public function test_expiry_removes_feedback_and_prevents_review_response_and_reupload(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $member);
        $task = $this->assignment($owner, $profile, $member);
        $data = $this->manifest($member, $profile, ['assignmentId' => $task['id'], 'shot' => 'Вход']);
        $this->upload($member, $data)->assertOk();
        $path = '/api/v1/prototype/photos/'.$data['id'];
        $this->postJson($path.'/review', ['state' => 'correction', 'comment' => 'Synthetic comment', 'revision' => 1], $owner['headers'])->assertOk();
        $this->travel(1)->hours();
        $this->getJson('/api/v1/prototype/assignments/'.$task['id'], $member['headers'])->assertJsonCount(0, 'submissions');
        $this->postJson($path.'/review', ['state' => 'accepted', 'comment' => '', 'revision' => 2], $owner['headers'])->assertGone();
        $this->postJson($path.'/response', ['comment' => 'Late reply', 'revision' => 2], $member['headers'])->assertGone();
        $this->upload($member, $data)->assertGone();
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertDatabaseHas('prototype_photos', ['id' => $data['id'], 'review_comment' => null, 'response_comment' => null, 'metadata' => null]);
    }

    public function test_feedback_without_assignment_and_lost_metadata_ack_do_not_grant_archive_reading(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $other = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $member);
        $this->join($owner, $profile, $other);
        $photo = $this->manifest($member, $profile);
        $this->upload($member, $photo)->assertOk();
        $path = '/api/v1/prototype/photos/'.$photo['id'];
        $changes = ['title' => '', 'note' => 'Synthetic sidecar', 'favorite' => false, 'revision' => 1];
        $this->patchJson($path, $changes, $member['headers'])->assertOk()->assertJsonPath('photo.remoteRevision', 2);
        $this->patchJson($path, $changes, $member['headers'])->assertOk()->assertJsonPath('photo.remoteRevision', 2);
        $this->getJson($path, $member['headers'])->assertForbidden();
        $this->postJson($path.'/review', ['state' => 'reshoot', 'comment' => 'Synthetic feedback', 'revision' => 1], $owner['headers'])->assertOk();
        $this->getJson('/api/v1/prototype/submissions', $member['headers'])->assertJsonCount(1, 'submissions')
            ->assertJsonPath('submissions.0.comment', 'Synthetic feedback')->assertJsonPath('submissions.0.canRead', false)
            ->assertJsonMissingPath('submissions.0.metadata')->assertJsonMissingPath('submissions.0.note');
        $this->getJson('/api/v1/prototype/submissions', $other['headers'])->assertJsonCount(0, 'submissions');
        $this->upload($member, $this->manifest($member, $profile, ['replacesId' => $photo['id']]))->assertOk();
    }

    public function test_upload_cancellation_is_scoped_to_creator_and_survives_a_lost_upload_ack(): void
    {
        $owner = $this->actor();
        $member = $this->actor();
        $other = $this->actor();
        $profile = $this->share($owner, $this->profile($owner));
        $this->join($owner, $profile, $member);
        $this->join($owner, $profile, $other);
        $photo = $this->manifest($member, $profile);
        $this->upload($member, $photo)->assertOk();
        $path = '/api/v1/prototype/photos/'.$photo['id'];
        $this->deleteJson($path, ['spaceId' => $profile['spaceId']], $other['headers'])->assertForbidden();
        $this->deleteJson($path, ['spaceId' => $profile['spaceId']], $member['headers'])->assertOk();
        $this->upload($member, $photo)->assertGone();
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $unuploaded = $this->manifest($member, $profile);
        $this->deleteJson('/api/v1/prototype/photos/'.$unuploaded['id'], ['spaceId' => $profile['spaceId']], $member['headers'])->assertOk();
        $this->upload($member, $unuploaded)->assertGone();
        $this->assertDatabaseCount('prototype_photos', 1);
    }
}
