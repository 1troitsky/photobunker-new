<?php

namespace Tests\Feature;

use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use App\Prototype\Retention;
use App\Workspace\Discussions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class WorkspaceTest extends TestCase
{
    use RefreshDatabase;

    private bool $matrixAvailable = false;

    private bool $roomCreated = false;

    private string $matrixOwner = '';

    private array $roomMembers = [];

    private const ROOM = '!workspace:matrix.photobunker.test';

    protected function setUp(): void
    {
        parent::setUp();
        config(['identity.enabled' => true]);
        $this->withCredentials()->withHeaders(['X-PhotoBunker' => 'identity-v1', 'Origin' => 'http://localhost:8080']);
        Storage::fake(config('prototype.disk'));
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            if (! $this->matrixAvailable) {
                return Http::response([], 503);
            }
            $path = parse_url($request->url(), PHP_URL_PATH);
            if (str_ends_with($path, '/login')) {
                $this->matrixOwner = $request['identifier']['user'];

                return Http::response(['user_id' => $this->matrixOwner, 'device_id' => 'PB_WORKSPACE', 'access_token' => 'synthetic-workspace-token']);
            }
            if (str_ends_with($path, '/account/whoami')) {
                return Http::response(['user_id' => $this->matrixOwner, 'device_id' => 'PB_WORKSPACE']);
            }
            if (str_contains($path, '/directory/room/')) {
                return Http::response($this->roomCreated ? ['room_id' => self::ROOM] : ['errcode' => 'M_NOT_FOUND'], $this->roomCreated ? 200 : 404);
            }
            if (str_ends_with($path, '/createRoom')) {
                $this->roomCreated = true;
                $this->roomMembers[$this->matrixOwner] = 'join';
                $this->assertSame('m.megolm.v1.aes-sha2', $request['initial_state'][0]['content']['algorithm']);

                return Http::response(['room_id' => self::ROOM]);
            }
            if (str_ends_with($path, '/state/m.room.create')) {
                return Http::response(['room_version' => '12']);
            }
            if ($request->method() === 'PUT' && str_ends_with($path, '/state/m.room.power_levels')) {
                $this->assertSame([], (array) $request['users']);
                $this->assertSame(50, $request['invite']);

                return Http::response([]);
            }
            if (str_ends_with($path, '/state')) {
                $task = DB::table('workspace_records')->where('kind', 'task')->first();

                return Http::response([['type' => 'm.room.create', 'sender' => $this->matrixOwner], ['type' => 'org.photobunker.assignment', 'content' => ['id' => $task->id]], ['type' => 'm.room.encryption', 'content' => ['algorithm' => 'm.megolm.v1.aes-sha2']]]);
            }
            if (str_ends_with($path, '/members')) {
                return Http::response(['chunk' => collect($this->roomMembers)->map(fn ($state, $user) => ['state_key' => $user, 'content' => ['membership' => $state]])->values()->all()]);
            }
            if (str_ends_with($path, '/invite')) {
                $this->roomMembers[$request['user_id']] = 'invite';
            }
            if (str_ends_with($path, '/kick')) {
                unset($this->roomMembers[$request['user_id']]);
            }

            return Http::response([]);
        });
    }

    private function fixture(): array
    {
        $id = (string) Str::uuid();
        $device = (string) Str::uuid();
        $token = bin2hex(random_bytes(32));
        $public = 'pb_'.strtolower(Str::random(16));
        DB::table('identity_accounts')->insert(['id' => $id, 'public_id' => $public, 'public_key' => 'synthetic-public', 'key_fingerprint' => hash('sha256', $id),
            'profile' => Crypt::encryptString(json_encode(['fields' => array_fill_keys(Accounts::FIELDS, ''), 'visibility' => array_fill_keys(Accounts::FIELDS, 'private')])), 'matrix_password' => Crypt::encryptString('synthetic-generated-password'), 'matrix_state' => 'ready', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('identity_devices')->insert(['id' => $device, 'account_id' => $id, 'public_key' => 'synthetic-device', 'name' => 'Synthetic workspace device', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('identity_sessions')->insert(['token_hash' => hash('sha256', $token), 'device_id' => $device, 'expires_at' => now()->addYear(), 'created_at' => now()]);

        return compact('id', 'public', 'device', 'token');
    }

    private function actor(array $fixture): self
    {
        $this->withUnencryptedCookie('pb_identity', $fixture['token']);
        $this->withHeader('X-PhotoBunker-Account', $fixture['id']);

        return $this;
    }

    private function contact(array $one, array $two): void
    {
        $pair = [$one['id'], $two['id']];
        sort($pair);
        foreach ([[$one['id'], $two['id']], [$two['id'], $one['id']]] as [$owner, $contact]) {
            DB::table('identity_address_book')->insert(['id' => (string) Str::uuid(), 'account_id' => $owner, 'contact_id' => $contact, 'created_at' => now()]);
        }
    }

    private function participant(array $fixture, string $role = 'contributor', string $scope = 'default'): array
    {
        return ['id' => $fixture['public'], 'name' => '', 'role' => $role, 'notify' => true, 'photoScope' => $scope];
    }

    private function task(array $participants = []): array
    {
        return ['name' => 'Synthetic assignment', 'revision' => 0, 'instructions' => 'Synthetic instructions', 'startsAt' => null, 'finishesAt' => null, 'targetCount' => 2, 'shots' => ['First', 'Second'], 'teamId' => '', 'presetId' => '', 'preset' => null, 'completed' => false, 'participants' => $participants,
            'rules' => ['categoryRequired' => false, 'particularCategory' => false, 'categories' => [], 'descriptionRequired' => false, 'minLength' => 10, 'changesAllowed' => true, 'keepOriginal' => true, 'deletionAllowed' => true, 'galleryAllowed' => true, 'thumbnailsOnly' => false, 'sharingAllowed' => true, 'participantsOnly' => true]];
    }

    private function saveTask(array $owner, array $data): array
    {
        $id = (string) Str::uuid();

        return $this->actor($owner)->putJson('/api/v1/identity/workspace/task/'.$id, $data)->assertOk()->json();
    }

    private function accept(array $person, array $task): void
    {
        $invite = DB::table('workspace_members')->where('record_id', $task['id'])->where('account_id', $person['id'])->value('id');
        $this->actor($person)->patchJson('/api/v1/identity/workspace/invitations/'.$invite, ['accept' => true])->assertOk();
    }

    private function upload(array $actor, ?array $task = null, ?string $id = null, string $original = 'synthetic original bytes', array $overrides = [])
    {
        $this->actor($actor);
        $anchor = $this->postJson('/api/v1/identity/workspace/clock')->assertOk()->json();
        $manifest = ['id' => $id ?? (string) Str::uuid(), 'createdAt' => Retention::milliseconds(), 'width' => 800, 'height' => 600, 'mime' => 'image/jpeg', 'method' => 'demo', 'title' => 'Synthetic photo', 'note' => '', 'favorite' => false,
            'retentionAnchor' => $anchor['id'], 'retentionSeconds' => 3600, 'expiresAt' => Retention::milliseconds() + 3600000, 'originalChecksum' => hash('sha256', $original), 'thumbnailChecksum' => hash('sha256', 'synthetic thumbnail'), 'previewChecksum' => hash('sha256', 'synthetic preview')];
        if ($task) {
            $manifest += ['assignmentId' => $task['id'], 'taskRevision' => $task['revision'], 'shot' => 'First'];
        }

        return $this->post('/api/v1/identity/workspace/photos', ['manifest' => json_encode([...$manifest, ...$overrides]), 'original' => UploadedFile::fake()->createWithContent('original.jpg', $original), 'thumbnail' => UploadedFile::fake()->createWithContent('thumbnail.jpg', 'synthetic thumbnail'), 'preview' => UploadedFile::fake()->createWithContent('preview.jpg', 'synthetic preview')], ['Accept' => 'application/json']);
    }

    public function test_photo_name_leases_are_disjoint_idempotent_and_do_not_reuse_codes(): void
    {
        $owner = $this->fixture();
        $member = $this->fixture();
        $outsider = $this->fixture();
        $this->contact($owner, $member);
        $task = $this->saveTask($owner, $this->task([$this->participant($member)]));
        $this->accept($member, $task);

        $url = '/api/v1/identity/photo-names/reserve';
        $claimUrl = '/api/v1/identity/photo-names/claim';
        $keyA = (string) Str::uuid();
        $keyB = (string) Str::uuid();
        $first = $this->actor($owner)->postJson($url, [
            'requestKey' => $keyA, 'assignmentId' => $task['id'], 'count' => 4,
        ])->assertOk()->json();
        $again = $this->postJson($url, [
            'requestKey' => $keyA, 'assignmentId' => $task['id'], 'count' => 4,
        ])->assertOk()->json();
        $this->assertSame($first, $again);
        $second = $this->actor($member)->postJson($url, [
            'requestKey' => $keyB, 'assignmentId' => $task['id'], 'count' => 4,
        ])->assertOk()->json();
        $this->assertSame($first['prefix'], $second['prefix']);
        $this->assertSame($first['last'] + 1, $second['first']);
        $this->actor($outsider)->postJson($url, [
            'requestKey' => (string) Str::uuid(), 'assignmentId' => $task['id'],
        ])->assertNotFound();

        $id = (string) Str::uuid();
        $body = ['photoId' => $id, 'assignmentId' => $task['id'],
            'leaseId' => $first['id'], 'number' => $first['first']];
        $code = $this->actor($owner)->postJson($claimUrl, $body)
            ->assertOk()->json('code');
        $this->assertMatchesRegularExpression('/^[A-Z]{4}[0-9]{4}$/', $code);
        $this->postJson($claimUrl, $body)->assertOk()->assertJsonPath('code', $code);
        $this->postJson($claimUrl, [
            'photoId' => $id, 'assignmentId' => $task['id'],
        ])->assertOk()->assertJsonPath('code', $code);
        $this->postJson($claimUrl, [
            ...$body, 'photoId' => (string) Str::uuid(),
        ])->assertConflict();
        $this->actor($member)->postJson($claimUrl, $body)->assertNotFound();
        $this->actor($owner)->postJson($claimUrl, [
            'photoId' => (string) Str::uuid(), 'assignmentId' => $task['id'],
            'leaseId' => $second['id'], 'number' => $second['first'],
        ])->assertForbidden();
        $this->assertDatabaseCount('photo_name_codes', 1);
    }

    public function test_workspace_photo_upload_uses_reserved_name_and_keeps_legacy_short_id(): void
    {
        $owner = $this->fixture();
        $id = (string) Str::uuid();
        $this->upload($owner, null, $id, 'name-id-photo', [
            'needsName' => true, 'shortId' => null,
        ])->assertConflict();

        $lease = $this->actor($owner)->postJson('/api/v1/identity/photo-names/reserve', [
            'requestKey' => (string) Str::uuid(), 'assignmentId' => null,
        ])->assertOk()->json();
        $code = $this->postJson('/api/v1/identity/photo-names/claim', [
            'photoId' => $id, 'assignmentId' => null,
            'leaseId' => $lease['id'], 'number' => $lease['first'],
        ])->assertOk()->json('code');

        $this->upload($owner, null, $id, 'name-id-photo', [
            'needsName' => true, 'shortId' => $code, 'title' => '',
        ])->assertOk()->assertJsonPath('photo.shortId', $code)
            ->assertJsonPath('photo.title', $code);
        $this->getJson('/api/v1/identity/workspace/photos/'.$id)
            ->assertOk()->assertJsonPath('photo.shortId', $code);

        $editedId = (string) Str::uuid();
        $editedCode = $this->postJson('/api/v1/identity/photo-names/claim', [
            'photoId' => $editedId, 'assignmentId' => null,
        ])->assertOk()->json('code');
        $this->upload($owner, null, $editedId, 'custom-title-photo', [
            'needsName' => true, 'shortId' => $editedCode, 'title' => 'Synthetic photo',
        ])->assertOk()->assertJsonPath('photo.title', 'Synthetic photo');

        $legacyId = (string) Str::uuid();
        $legacy = $this->upload($owner, null, $legacyId)->assertOk()->json('photo.shortId');
        $this->assertSame(10, strlen($legacy));
        $this->postJson('/api/v1/identity/photo-names/claim', [
            'photoId' => $legacyId, 'assignmentId' => null,
        ])->assertConflict();
        $this->getJson('/api/v1/identity/workspace/photos/'.$legacyId)
            ->assertOk()->assertJsonPath('photo.shortId', $legacy);
    }

    public function test_photo_name_prefix_rolls_over_after_9999_without_renaming_issued_codes(): void
    {
        $owner = $this->fixture();
        $url = '/api/v1/identity/photo-names/reserve';
        $first = $this->actor($owner)->postJson($url, [
            'requestKey' => (string) Str::uuid(), 'assignmentId' => null, 'count' => 2,
        ])->assertOk()->json();
        DB::table('photo_name_prefixes')->where('prefix', $first['prefix'])
            ->update(['next_number' => 9999]);
        $end = $this->postJson($url, [
            'requestKey' => (string) Str::uuid(), 'assignmentId' => null, 'count' => 32,
        ])->assertOk()->json();
        $this->assertSame(9999, $end['first']);
        $this->assertSame(9999, $end['last']);
        $photoId = (string) Str::uuid();
        $code = $this->postJson('/api/v1/identity/photo-names/claim', [
            'photoId' => $photoId, 'assignmentId' => null,
            'leaseId' => $end['id'], 'number' => 9999,
        ])->assertOk()->json('code');
        $next = $this->postJson($url, [
            'requestKey' => (string) Str::uuid(), 'assignmentId' => null,
        ])->assertOk()->json();
        $this->assertNotSame($first['prefix'], $next['prefix']);
        $this->assertSame(1, $next['first']);
        $this->assertSame($first['prefix'].'9999', $code);
        $this->assertDatabaseHas('photo_name_codes', ['photo_id' => $photoId, 'code' => $code]);
    }

    public function test_team_acceptance_does_not_grant_assignment_or_photo_access_and_actor_binding_is_enforced(): void
    {
        $owner = $this->fixture();
        $member = $this->fixture();
        $outsider = $this->fixture();
        $this->contact($owner, $member);
        $id = (string) Str::uuid();
        $team = $this->actor($owner)->putJson('/api/v1/identity/workspace/team/'.$id, ['revision' => 0, 'name' => 'Synthetic team', 'participants' => [$this->participant($member)]])->assertOk()->json();
        $this->actor($member)->getJson('/api/v1/identity/workspace')->assertOk()->assertJsonCount(0, 'teams')->assertJsonCount(1, 'invitations');
        $this->accept($member, $team);
        $this->getJson('/api/v1/identity/workspace')->assertOk()->assertJsonCount(1, 'teams');
        $task = $this->saveTask($owner, $this->task());
        $photo = $this->upload($owner, $task)->assertOk()->json('photo');
        $this->actor($member)->getJson('/api/v1/identity/workspace/task/'.$task['id'])->assertNotFound();
        $this->getJson('/api/v1/identity/workspace/photos/'.$photo['id'])->assertNotFound();
        $this->putJson('/api/v1/identity/workspace/team/'.$id, [...$team, 'revision' => 2, 'name' => 'Cannot escalate'])->assertNotFound();
        $this->actor($outsider)->withHeader('X-PhotoBunker-Account', $owner['id'])->getJson('/api/v1/identity/workspace')->assertConflict();
        $this->assertDatabaseHas('workspace_records', ['id' => $id, 'owner_id' => $owner['id']]);
    }

    public function test_team_description_is_private_revisioned_and_does_not_create_a_matrix_room(): void
    {
        $owner = $this->fixture();
        $member = $this->fixture();
        $outsider = $this->fixture();
        $this->contact($owner, $member);
        $id = (string) Str::uuid();
        $url = '/api/v1/identity/workspace/team/'.$id;

        $team = $this->actor($owner)->putJson($url, [
            'revision' => 0, 'name' => 'Private studio',
            'description' => 'A private description',
            'participants' => [$this->participant($member)],
        ])->assertOk()->assertJsonPath('description', 'A private description')->json();

        $this->actor($outsider)->getJson($url)->assertNotFound();
        $this->actor($member)->getJson($url)->assertNotFound();
        $this->accept($member, $team);
        $this->actor($member)->getJson($url)->assertOk()->assertJsonPath('description', 'A private description');
        $this->putJson($url, [...$team, 'description' => 'Not allowed'])->assertNotFound();

        $current = $this->actor($owner)->getJson($url)->assertOk()->json();
        $updated = $this->putJson($url, [
            ...$current, 'description' => 'Updated description',
        ])->assertOk()->assertJsonPath('revision', 3)
            ->assertJsonPath('description', 'Updated description')->json();
        $this->getJson($url)->assertOk()->assertJsonPath('description', 'Updated description');
        $this->putJson($url, [...$updated, 'description' => str_repeat('x', 1001)])
            ->assertUnprocessable();
        $this->assertNull(DB::table('workspace_records')->where('id', $id)->value('room_id'));
    }

    public function test_upload_only_and_thumbnail_grants_are_enforced_by_every_endpoint_and_revocation(): void
    {
        $owner = $this->fixture();
        $drop = $this->fixture();
        $viewer = $this->fixture();
        $outsider = $this->fixture();
        $this->contact($owner, $drop);
        $this->contact($owner, $viewer);
        $task = $this->saveTask($owner, $this->task([$this->participant($drop, 'contributor', 'none'), $this->participant($viewer, 'viewer', 'thumbnails')]));
        $this->accept($drop, $task);
        $this->accept($viewer, $task);
        $receipt = $this->upload($drop, $task)->assertOk()->assertJsonPath('photo.uploadOnly', true)->json('photo');
        $this->assertArrayNotHasKey('title', $receipt);
        $this->actor($drop)->getJson('/api/v1/identity/workspace/photos')->assertOk()->assertJsonCount(0, 'photos')->assertJsonCount(1, 'receipts');
        foreach (['', '/original', '/thumbnail'] as $suffix) {
            $this->getJson('/api/v1/identity/workspace/photos/'.$receipt['id'].$suffix)->assertForbidden();
        }
        $this->postJson('/api/v1/identity/workspace/photos/'.$receipt['id'].'/reference')->assertForbidden();
        $this->actor($viewer)->getJson('/api/v1/identity/workspace/photos/'.$receipt['id'])->assertOk()->assertJsonPath('photo.thumbnailOnly', true)->assertJsonPath('photo.workspaceAccess.edit', false);
        $this->get('/api/v1/identity/workspace/photos/'.$receipt['id'].'/thumbnail')->assertOk()->assertStreamedContent('synthetic thumbnail');
        $this->getJson('/api/v1/identity/workspace/photos/'.$receipt['id'].'/original')->assertForbidden();
        $this->patchJson('/api/v1/identity/workspace/photos/'.$receipt['id'], ['revision' => 1, 'title' => '', 'note' => '', 'favorite' => false])->assertForbidden();
        $this->deleteJson('/api/v1/identity/workspace/photos/'.$receipt['id'])->assertForbidden();
        $this->actor($outsider)->getJson('/api/v1/identity/workspace/photos/'.$receipt['id'])->assertNotFound();
        $this->actor($owner)->get('/api/v1/identity/workspace/photos/'.$receipt['id'].'/original')->assertOk()->assertStreamedContent('synthetic original bytes');
        $current = $this->getJson('/api/v1/identity/workspace/task/'.$task['id'])->json();
        $this->putJson('/api/v1/identity/workspace/task/'.$task['id'], [...$current, 'participants' => []])->assertOk();
        $this->actor($viewer)->getJson('/api/v1/identity/workspace/photos/'.$receipt['id'])->assertNotFound();
        $this->actor($drop)->getJson('/api/v1/identity/workspace/photos')->assertOk()->assertJsonCount(0, 'receipts');
    }

    public function test_invitation_expiry_decline_block_and_reentry_do_not_implicitly_grant_access(): void
    {
        $owner = $this->fixture();
        $person = $this->fixture();
        $this->contact($owner, $person);
        $task = $this->saveTask($owner, $this->task([$this->participant($person)]));
        $member = DB::table('workspace_members')->where('record_id', $task['id'])->first();
        DB::table('workspace_members')->where('id', $member->id)->update(['expires_at' => Retention::milliseconds() - 1]);
        $this->actor($person)->patchJson('/api/v1/identity/workspace/invitations/'.$member->id, ['accept' => true])->assertGone();
        $this->patchJson('/api/v1/identity/workspace/invitations/'.$member->id, ['accept' => false])->assertOk();
        $this->getJson('/api/v1/identity/workspace/task/'.$task['id'])->assertNotFound();
        $current = $this->actor($owner)->getJson('/api/v1/identity/workspace/task/'.$task['id'])->json();
        $fresh = $this->putJson('/api/v1/identity/workspace/task/'.$task['id'], $current)->assertOk()->json();
        $invite = DB::table('workspace_members')->where('record_id', $task['id'])->first();
        $this->assertNotSame($member->id, $invite->id);
        DB::table('identity_blocks')->insert(['account_id' => $owner['id'], 'blocked_id' => $person['id'], 'created_at' => now()]);
        $this->actor($person)->patchJson('/api/v1/identity/workspace/invitations/'.$invite->id, ['accept' => true])->assertForbidden();
        $this->patchJson('/api/v1/identity/workspace/invitations/'.$invite->id, ['accept' => false])->assertOk();
    }

    public function test_revision_immutable_original_expiry_and_cleanup_are_enforced(): void
    {
        $owner = $this->fixture();
        $task = $this->saveTask($owner, $this->task());
        $photo = $this->upload($owner, $task)->assertOk()->json('photo');
        $this->upload($owner, $task, $photo['id'], 'different original bytes')->assertConflict();
        $this->patchJson('/api/v1/identity/workspace/photos/'.$photo['id'], ['revision' => 1, 'title' => 'Changed', 'note' => 'Synthetic note', 'favorite' => false])->assertOk()->assertJsonPath('photo.remoteRevision', 2);
        $this->patchJson('/api/v1/identity/workspace/photos/'.$photo['id'], ['revision' => 1, 'title' => 'Changed', 'note' => 'Synthetic note', 'favorite' => false])->assertOk()->assertJsonPath('photo.remoteRevision', 2);
        $this->patchJson('/api/v1/identity/workspace/photos/'.$photo['id'], ['revision' => 1, 'title' => 'Stale', 'note' => '', 'favorite' => false])->assertConflict();
        $this->patchJson('/api/v1/identity/workspace/photos/'.$photo['id'], ['revision' => 2, 'title' => 'Changed', 'note' => '', 'favorite' => false, 'expiresAt' => $photo['expiresAt'] + 1])->assertUnprocessable();
        $stored = DB::table('workspace_photos')->find($photo['id']);
        $this->assertStringNotContainsString('Synthetic note', $stored->manifest);
        $this->travel(2)->hours();
        $this->getJson('/api/v1/identity/workspace/photos/'.$photo['id'])->assertGone();
        $this->getJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/original')->assertGone();
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/reference')->assertGone();
        $this->artisan('photobunker:workspace-maintain')->assertSuccessful();
        Storage::disk(config('prototype.disk'))->assertMissing($stored->original_key);
        Storage::disk(config('prototype.disk'))->assertMissing($stored->thumbnail_key);
        $this->assertDatabaseHas('workspace_photos', ['id' => $photo['id'], 'state' => 'deleted']);
    }

    public function test_discussion_membership_is_metadata_only_restartable_and_never_a_photo_grant(): void
    {
        $owner = $this->fixture();
        $person = $this->fixture();
        $outsider = $this->fixture();
        $this->contact($owner, $person);
        $task = $this->saveTask($owner, $this->task([$this->participant($person, 'contributor', 'none')]));
        $this->accept($person, $task);
        $photo = $this->upload($owner, $task)->assertOk()->json('photo');
        $this->actor($person)->postJson('/api/v1/identity/workspace/assignments/'.$task['id'].'/discussion')->assertStatus(202)->assertJsonPath('state', 'pending');
        $this->matrixAvailable = true;
        $this->postJson('/api/v1/identity/workspace/assignments/'.$task['id'].'/discussion')->assertOk()->assertJsonPath('state', 'ready');
        $this->assertSame('invite', $this->roomMembers[app(MatrixBridge::class)->mxid($person['id'])]);
        $this->getJson('/api/v1/identity/workspace/photos/'.$photo['id'])->assertForbidden();
        $this->roomMembers[app(MatrixBridge::class)->mxid($outsider['id'])] = 'join';
        $this->actor($outsider)->getJson('/api/v1/identity/workspace/photos/'.$photo['id'])->assertNotFound();
        $current = $this->actor($owner)->getJson('/api/v1/identity/workspace/task/'.$task['id'])->json();
        $this->putJson('/api/v1/identity/workspace/task/'.$task['id'], [...$current, 'participants' => []])->assertOk()->assertJsonPath('discussion.state', 'pending');
        $this->matrixAvailable = false;
        try {
            app(Discussions::class)->reconcile($task['id']);
        } catch (\Throwable) {
        }
        $this->actor($person)->getJson('/api/v1/identity/workspace/photos/'.$photo['id'])->assertNotFound();
        $this->assertDatabaseHas('workspace_records', ['id' => $task['id'], 'room_state' => 'pending']);
        $this->matrixAvailable = true;
        app(Discussions::class)->reconcile($task['id']);
        $this->assertSame([app(MatrixBridge::class)->mxid($owner['id']) => 'join'], $this->roomMembers);
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/media/') || str_contains($request->url(), '/send/'));
    }

    public function test_explicit_configuration_import_is_idempotent_and_never_imports_legacy_grants(): void
    {
        $owner = $this->fixture();
        $stranger = $this->fixture();
        $data = $this->task([['id' => 'legacy-text-only', 'name' => 'Former participant', 'role' => 'curator']]);
        $this->actor($owner);
        $first = $this->postJson('/api/v1/identity/workspace/import-record', ['kind' => 'task', 'source' => 'device:old-task', 'value' => $data])->assertOk()->assertJsonPath('participants', [])->json();
        $again = $this->postJson('/api/v1/identity/workspace/import-record', ['kind' => 'task', 'source' => 'device:old-task', 'value' => $data])->assertOk()->json();
        $this->assertSame($first['id'], $again['id']);
        $this->assertDatabaseCount('workspace_records', 1);
        $this->assertDatabaseCount('workspace_members', 0);
        $this->actor($stranger)->getJson('/api/v1/identity/workspace/task/'.$first['id'])->assertNotFound();
        $this->actor($owner)->deleteJson('/api/v1/identity/workspace/task/'.$first['id'], ['revision' => 1])->assertOk();
        $this->postJson('/api/v1/identity/workspace/import-record', ['kind' => 'task', 'source' => 'device:old-task', 'value' => $data])->assertNotFound();
    }

    public function test_legacy_photo_copy_requires_proof_preserves_source_and_cannot_resurrect_deleted_target(): void
    {
        $owner = $this->fixture();
        $other = $this->fixture();
        $library = (string) Str::uuid();
        $id = (string) Str::uuid();
        $code = bin2hex(random_bytes(32));
        DB::table('prototype_libraries')->insert(['id' => $library, 'token_hash' => hash('sha256', $code), 'created_at' => now()]);
        DB::table('prototype_photos')->insert(['library_id' => $library, 'id' => $id, 'state' => 'active', 'original_key' => 'legacy/fixture-original', 'thumbnail_key' => 'legacy/fixture-thumbnail',
            'fingerprint' => hash('sha256', 'fixture'), 'bytes' => 15, 'thumbnail_bytes' => 16, 'captured_at' => Retention::milliseconds(), 'width' => 800, 'height' => 600, 'mime' => 'image/jpeg', 'method' => 'demo', 'note' => 'Synthetic legacy note', 'created_at' => now(), 'expires_at' => Retention::milliseconds() + 3600000]);
        $disk = Storage::disk(config('prototype.disk'));
        $disk->put('legacy/fixture-original', 'legacy original');
        $disk->put('legacy/fixture-thumbnail', 'legacy thumbnail');
        $this->actor($owner)->postJson('/api/v1/identity/workspace/legacy/photos/'.$id.'/import', ['libraryId' => $library])->assertForbidden();
        $this->postJson('/api/v1/identity/legacy-proof', ['libraryCode' => $code])->assertOk();
        $this->getJson('/api/v1/identity/workspace/legacy')->assertOk()->assertJsonCount(1, 'photos');
        $copied = $this->postJson('/api/v1/identity/workspace/legacy/photos/'.$id.'/import', ['libraryId' => $library])->assertOk()->json('id');
        $this->postJson('/api/v1/identity/workspace/legacy/photos/'.$id.'/import', ['libraryId' => $library])->assertOk()->assertJsonPath('id', $copied);
        $this->get('/api/v1/identity/workspace/photos/'.$copied.'/original')->assertOk()->assertStreamedContent('legacy original');
        $this->getJson('/api/v1/identity/workspace/photos/'.$copied)->assertOk()->assertJsonPath('photo.captureContext.author.kind', 'unknown');
        $target = DB::table('workspace_photos')->find($copied);
        $this->assertNotSame('legacy/fixture-original', $target->original_key);
        $this->assertLessThanOrEqual(Retention::milliseconds() + 3600000, $target->expires_at);
        $this->assertDatabaseHas('prototype_photos', ['library_id' => $library, 'id' => $id, 'state' => 'active', 'note' => 'Synthetic legacy note']);
        $disk->assertExists('legacy/fixture-original');
        $this->actor($other)->postJson('/api/v1/identity/workspace/legacy/photos/'.$id.'/import', ['libraryId' => $library])->assertForbidden();
        $this->actor($owner)->deleteJson('/api/v1/identity/workspace/photos/'.$copied)->assertOk();
        $this->postJson('/api/v1/identity/workspace/legacy/photos/'.$id.'/import', ['libraryId' => $library])->assertGone();
        $disk->assertExists('legacy/fixture-original');
        DB::table('identity_devices')->where('account_id', $owner['id'])->update(['name' => 'QA legacy fixture']);
        $options = ['account' => $owner['id'], '--fingerprint' => hash('sha256', $owner['id']), '--library' => $library, '--library-fingerprint' => str_repeat('0', 64), '--photo' => $id];
        $this->artisan('photobunker:workspace-legacy-cleanup', $options)->assertFailed();
        $this->assertDatabaseHas('prototype_libraries', ['id' => $library]);
        $options['--library-fingerprint'] = hash('sha256', $code);
        $this->artisan('photobunker:workspace-legacy-cleanup', $options)->assertSuccessful();
        $this->assertDatabaseMissing('prototype_libraries', ['id' => $library]);
        $disk->assertMissing('legacy/fixture-original');
    }

    public function test_upload_only_feedback_and_capture_sidecar_never_grant_archive_read(): void
    {
        $owner = $this->fixture();
        $person = $this->fixture();
        $this->contact($owner, $person);
        $task = $this->saveTask($owner, $this->task([$this->participant($person, 'contributor', 'none')]));
        $this->accept($person, $task);
        $photo = $this->upload($person, $task)->assertOk()->json('photo');
        $metadata = ['location' => ['source' => 'gps', 'latitude' => 1, 'longitude' => 2, 'accuracy' => 5, 'measuredAt' => Retention::milliseconds()], 'locationStatus' => 'pending'];
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/capture-metadata', ['revision' => 1, 'metadata' => $metadata])->assertOk()->assertJsonPath('remoteRevision', 2);
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/capture-metadata', ['revision' => 1, 'metadata' => $metadata])->assertOk()->assertJsonPath('remoteRevision', 2);
        $this->getJson('/api/v1/identity/workspace/photos/'.$photo['id'])->assertForbidden();
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/review', ['revision' => 1, 'state' => 'accepted', 'comment' => ''])->assertForbidden();
        $this->actor($owner)->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/review', ['revision' => 1, 'state' => 'correction', 'comment' => 'Synthetic correction'])->assertOk();
        $this->actor($person)->getJson('/api/v1/identity/workspace/photos')->assertOk()->assertJsonPath('receipts.0.reviewComment', 'Synthetic correction');
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/response', ['revision' => 2, 'comment' => 'Synthetic response'])->assertOk();
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/response', ['revision' => 2, 'comment' => 'Stale response'])->assertConflict();
        $this->travel(3)->minutes();
        $this->postJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/capture-metadata', ['revision' => 4, 'metadata' => $metadata])->assertForbidden();
        $this->getJson('/api/v1/identity/workspace/photos/'.$photo['id'].'/original')->assertForbidden();
    }

    public function test_owner_quota_is_shared_between_vaults_and_committed_retry_survives_task_completion(): void
    {
        $this->freezeTime();
        $owner = $this->fixture();
        $person = $this->fixture();
        $this->contact($owner, $person);
        $task = $this->saveTask($owner, $this->task([$this->participant($person)]));
        $this->accept($person, $task);
        config(['prototype.max_photos' => 1]);
        $photo = $this->upload($person, $task)->assertOk()->assertJsonPath('photo.workspaceAccess.share', true)->assertJsonPath('photo.workspaceAccess.shareExternal', false)->json('photo');
        $this->upload($owner)->assertStatus(413);
        $current = $this->actor($owner)->getJson('/api/v1/identity/workspace/task/'.$task['id'])->json();
        $this->putJson('/api/v1/identity/workspace/task/'.$task['id'], [...$current, 'completed' => true])->assertOk();
        $this->upload($person, $task, $photo['id'])->assertOk();
        $this->upload($person, $task)->assertForbidden();
        $this->assertDatabaseCount('workspace_photos', 1);
    }

    public function test_mapped_owner_import_preserves_closed_assignment_archive_without_reopening_capture(): void
    {
        $this->freezeTime();
        $owner = $this->fixture();
        $person = $this->fixture();
        $this->contact($owner, $person);
        $task = $this->saveTask($owner, [...$this->task([$this->participant($person)]), 'completed' => true]);
        $this->accept($person, $task);
        $id = $this->actor($owner)->postJson('/api/v1/identity/workspace/import-photo-id', ['source' => 'synthetic-old-photo'])->assertOk()->json('id');
        $this->upload($owner, $task, overrides: ['legacyImport' => true])->assertForbidden();
        $this->upload($owner, $task, $id, overrides: ['legacyImport' => true, 'createdAt' => Retention::milliseconds() - 20 * 86400000])->assertOk()->assertJsonPath('photo.captureContext.author.kind', 'device');
        $personId = $this->actor($person)->postJson('/api/v1/identity/workspace/import-photo-id', ['source' => 'synthetic-other-copy'])->assertOk()->json('id');
        $this->upload($person, $task, $personId, overrides: ['legacyImport' => true])->assertForbidden();
        $this->upload($owner, $task)->assertForbidden();
        $this->assertDatabaseCount('workspace_photos', 1);
    }

    public function test_failed_object_write_and_delete_remain_pending_and_retry_without_resurrection(): void
    {
        $this->freezeTime();
        $owner = $this->fixture();
        $manager = Storage::getFacadeRoot();
        $disk = Storage::disk(config('prototype.disk'));
        $failure = \Mockery::mock();
        $failure->shouldReceive('put')->andReturn(false);
        Storage::shouldReceive('disk')->andReturn($failure);
        $id = (string) Str::uuid();
        $this->upload($owner, null, $id)->assertServiceUnavailable();
        $this->assertDatabaseHas('workspace_photos', ['id' => $id, 'state' => 'pending']);
        Storage::swap($manager);
        $this->upload($owner, null, $id)->assertOk();
        $row = DB::table('workspace_photos')->find($id);
        $disk->assertExists($row->original_key);
        $failure = \Mockery::mock();
        $failure->shouldReceive('delete')->andReturn(false);
        Storage::shouldReceive('disk')->andReturn($failure);
        $this->deleteJson('/api/v1/identity/workspace/photos/'.$id)->assertStatus(202)->assertJsonPath('deletion', 'pending');
        $this->getJson('/api/v1/identity/workspace/photos/'.$id)->assertGone();
        Storage::swap($manager);
        $this->artisan('photobunker:workspace-maintain')->assertSuccessful();
        foreach ([$row->original_key, $row->preview_key, $row->thumbnail_key] as $key) {
            $disk->assertMissing($key);
        }
        $this->upload($owner, null, $id)->assertGone();
        $this->assertDatabaseCount('workspace_photos', 1);
    }

    public function test_photo_browser_link_never_grants_membership_or_original_access(): void
    {
        $owner = $this->fixture();
        $viewer = $this->fixture();
        $stranger = $this->fixture();
        $this->contact($owner, $viewer);
        $task = $this->saveTask($owner, $this->task([$this->participant($viewer, 'viewer', 'thumbnails')]));
        $this->accept($viewer, $task);
        $photo = $this->upload($owner, $task)->assertOk()->json('photo');
        $id = (string) Str::uuid();
        $expires = Retention::milliseconds() + 3600_000;
        $url = '/api/v1/identity/workspace/browser/'.$id;
        $body = ['assignmentIds' => [$task['id']], 'expiresAt' => $expires];
        $this->actor($owner)->putJson($url, $body)->assertOk()
            ->assertJsonPath('assignments.0.id', $task['id'])
            ->assertJsonPath('canRevoke', true);
        $response = $this->actor($viewer)->getJson($url)->assertOk()
            ->assertJsonPath('canRevoke', false)
            ->assertJsonMissingPath('photos')
            ->assertJsonMissingPath('original')
            ->assertJsonMissingPath('metadata');
        $this->assertStringNotContainsString($photo['id'], $response->getContent());
        $this->actor($viewer)->get('/api/v1/identity/workspace/photos/'.$photo['id'].'/original')->assertForbidden();
        // Guessing or copying a browser URL never grants assignment rights.
        $this->actor($stranger)->getJson($url)->assertNotFound();
        $this->actor($owner)->deleteJson($url)->assertOk()->assertJsonPath('revoked', true);
        $this->actor($owner)->deleteJson($url)->assertOk();
        $this->actor($viewer)->getJson($url)->assertStatus(410);
    }

    public function test_browser_collection_is_idempotent_and_all_assignments_require_access(): void
    {
        $owner = $this->fixture();
        $viewer = $this->fixture();
        $this->contact($owner, $viewer);
        $first = $this->saveTask($owner, $this->task([$this->participant($viewer, 'viewer', 'all')]));
        $this->accept($viewer, $first);
        $second = $this->saveTask($owner, $this->task());
        $url = '/api/v1/identity/workspace/browser/'.Str::uuid();
        $expires = Retention::milliseconds() + 120_000;
        $body = ['assignmentIds' => [$first['id'], $second['id']], 'expiresAt' => $expires];
        $this->actor($owner)->putJson($url, $body)->assertOk();
        $this->actor($owner)->putJson($url, $body)->assertOk(); // lost ACK replay
        $this->assertDatabaseCount('workspace_photo_browsers', 1);
        $this->actor($owner)->putJson($url, [...$body, 'expiresAt' => $expires + 1000])
            ->assertConflict();
        // Cannot reveal even a partial list of otherwise authorized tasks.
        $this->actor($viewer)->getJson($url)->assertNotFound();
        DB::table('workspace_photo_browsers')->update(['expires_at' => Retention::milliseconds() - 1]);
        $this->actor($owner)->getJson($url)->assertStatus(410);
        $this->actor($owner)->putJson($url, $body)->assertStatus(410);
    }

    public function test_browser_creator_requires_owner_or_curator(): void
    {
        $owner = $this->fixture();
        $contributor = $this->fixture();
        $this->contact($owner, $contributor);
        $task = $this->saveTask($owner, $this->task([$this->participant($contributor)]));
        $this->accept($contributor, $task);
        $url = '/api/v1/identity/workspace/browser/'.Str::uuid();
        $body = ['assignmentIds' => [$task['id']], 'expiresAt' => Retention::milliseconds() + 120_000];
        $this->actor($contributor)->putJson($url, $body)->assertForbidden();
        $this->assertDatabaseCount('workspace_photo_browsers', 0);
    }
}
