<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PrototypeProfilesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['prototype.enabled' => true]);
        Storage::fake('s3');
    }

    private function access(): array
    {
        $token = $this->postJson('/api/v1/prototype/libraries')->assertCreated()->json('accessCode');

        return ['Authorization' => 'Bearer '.$token];
    }

    private function profile(): array
    {
        return ['name' => 'Осмотр', 'description' => '', 'version' => 0, 'archived' => false, 'rules' => [
            'resolution' => 'fixed', 'width' => 800, 'height' => 800, 'aspect' => '1:1', 'aspectWidth' => 4, 'aspectHeight' => 3,
            'fit' => 'crop', 'quality' => 0.94, 'metadata' => 'none', 'keepDate' => false, 'keepCamera' => false,
            'location' => 'off', 'accuracy' => 20, 'locationWindow' => 15, 'descriptionRequired' => true,
            'descriptionEditable' => false, 'categoryRequired' => true, 'categories' => ['Фасад'], 'shotList' => ['Вход'], 'idPrefix' => 'TEST',
        ]];
    }

    private function upload(array $headers, array $profile, array $extra = [])
    {
        return $this->post('/api/v1/prototype/photos', [
            'manifest' => json_encode([...[
                'id' => (string) Str::uuid(), 'createdAt' => 1791800000000, 'width' => 800, 'height' => 800,
                'mime' => 'image/jpeg', 'method' => 'demo', 'title' => '', 'note' => '', 'favorite' => false,
                'profile' => $profile, 'shortId' => 'TEST-1234ABC', 'category' => 'Фасад', 'shot' => 'Вход', 'metadata' => [],
            ], ...$extra]),
            'original' => UploadedFile::fake()->createWithContent('original', 'synthetic-profile-photo'),
            'thumbnail' => UploadedFile::fake()->createWithContent('thumbnail', 'synthetic-thumbnail'),
        ], $headers);
    }

    public function test_profiles_are_scoped_versioned_and_archivable_without_removing_photos(): void
    {
        $a = $this->access();
        $b = $this->access();
        $id = (string) Str::uuid();
        $this->getJson('/api/v1/prototype/profiles')->assertUnauthorized();
        $data = $this->profile();
        $first = $this->putJson('/api/v1/prototype/profiles/'.$id, $data, $a)->assertOk()->assertJsonPath('profile.version', 1)->json('profile');
        $photo = $this->upload($a, $first)->assertOk()->json('photo');
        $this->getJson('/api/v1/prototype/profiles', $b)->assertJsonCount(0, 'profiles');
        $this->upload($b, $first)->assertUnprocessable();
        $this->putJson('/api/v1/prototype/profiles/'.$id, [...$data, 'version' => 1, 'name' => 'Новые правила', 'archived' => true], $a)->assertOk()->assertJsonPath('profile.version', 2);
        $this->putJson('/api/v1/prototype/profiles/'.$id, $data, $a)->assertConflict();
        $this->getJson('/api/v1/prototype/photos/'.$photo['id'], $a)->assertOk()->assertJsonPath('photo.profile.name', 'Осмотр')->assertJsonPath('photo.profile.version', 1);
        $this->assertDatabaseCount('prototype_profile_versions', 2);
        $this->getJson('/api/v1/prototype/profiles', $a)->assertJsonPath('profiles.0.archived', true);
    }

    public function test_profile_rejects_inconsistent_sizes_and_data_policies(): void
    {
        $headers = $this->access();
        $id = (string) Str::uuid();
        $data = $this->profile();
        $bad = $data;
        $bad['rules']['height'] = 600;
        $this->putJson('/api/v1/prototype/profiles/'.$id, $bad, $headers)->assertUnprocessable();
        $bad = $data;
        $bad['rules']['keepCamera'] = true;
        $this->putJson('/api/v1/prototype/profiles/'.$id, $bad, $headers)->assertUnprocessable();
        $bad = $data;
        $bad['rules']['categories'] = [];
        $this->putJson('/api/v1/prototype/profiles/'.$id, $bad, $headers)->assertUnprocessable();
        $this->assertDatabaseCount('prototype_profiles', 0);
    }

    public function test_server_uses_its_snapshot_and_forbids_unselected_metadata_and_duplicate_codes(): void
    {
        $headers = $this->access();
        $id = (string) Str::uuid();
        $profile = $this->putJson('/api/v1/prototype/profiles/'.$id, $this->profile(), $headers)->assertOk()->json('profile');
        $this->upload($headers, $profile, ['metadata' => ['camera' => 'must-not-retain']])->assertUnprocessable();
        $this->upload($headers, $profile, ['metadata' => ['location' => ['latitude' => 1, 'longitude' => 2, 'accuracy' => 3, 'measuredAt' => 1791800000000]]])->assertUnprocessable();
        $forged = $profile;
        $forged['rules']['descriptionEditable'] = true;
        $this->upload($headers, $forged)->assertOk()->assertJsonPath('photo.profile.rules.descriptionEditable', false);
        $this->upload($headers, $profile)->assertConflict();
        $this->assertDatabaseCount('prototype_photos', 1);
    }

    public function test_locked_description_can_be_completed_once_but_not_changed_via_api(): void
    {
        $headers = $this->access();
        $profileId = (string) Str::uuid();
        $profile = $this->putJson('/api/v1/prototype/profiles/'.$profileId, $this->profile(), $headers)->json('profile');
        $photo = $this->upload($headers, $profile)->assertOk()->json('photo');
        $path = '/api/v1/prototype/photos/'.$photo['id'];
        $this->patchJson($path, ['title' => 'Title', 'note' => 'Первое описание', 'favorite' => false, 'revision' => 1], $headers)->assertOk();
        $this->patchJson($path, ['title' => 'Title', 'note' => 'Замена', 'favorite' => false, 'revision' => 2], $headers)->assertForbidden();
        $this->patchJson($path, ['title' => 'Title', 'note' => 'Первое описание', 'favorite' => true, 'revision' => 2], $headers)->assertOk();
        $this->assertSame('Первое описание', DB::table('prototype_photos')->value('note'));
    }

    public function test_retention_and_tags_obey_the_saved_profile_rules(): void
    {
        $headers = $this->access();
        $data = $this->profile();
        $data['rules']['retentionSeconds'] = 3600;
        $id = (string) Str::uuid();
        $profile = $this->putJson('/api/v1/prototype/profiles/'.$id, $data, $headers)->assertOk()->json('profile');
        $anchor = $this->postJson('/api/v1/prototype/clock', [], $headers)->assertOk()->json();
        $this->upload($headers, $profile)->assertUnprocessable();
        $retention = ['createdAt' => $anchor['issuedAt'], 'retentionAnchor' => $anchor['id'], 'retentionSeconds' => 3600];
        $this->upload($headers, $profile, [...$retention, 'retentionSeconds' => 86400])->assertUnprocessable();
        $this->upload($headers, $profile, [...$retention, 'tags' => array_fill(0, 21, 'oversized')])->assertUnprocessable();
        $photo = $this->upload($headers, $profile, $retention)->assertOk()->assertJsonPath('photo.expiresAt', $anchor['issuedAt'] + 3600000)->json('photo');
        $changes = ['title' => '', 'note' => '', 'favorite' => false, 'revision' => 1, 'tags' => ['осмотр', 'проверка']];
        $path = '/api/v1/prototype/photos/'.$photo['id'];
        $this->patchJson($path, $changes, $headers)->assertOk()->assertJsonPath('photo.tags', ['осмотр', 'проверка']);
        $this->patchJson($path, [...$changes, 'revision' => 2, 'tags' => ['замена']], $headers)->assertForbidden();
    }
}
