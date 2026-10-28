<?php
declare(strict_types=1);
namespace Tests\Feature;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
final class StorageCheckTest extends TestCase {
    public function test_synthetic_private_roundtrip_leaves_no_objects():void {
        Storage::fake('photo-ciphertext');
        $this->artisan('photobunker:storage-check')
          ->expectsOutput('Private storage PUT/HEAD/GET/DELETE and cleanup verified. Anonymous access must be checked at Garage endpoint.')
          ->assertExitCode(0);
        $this->assertSame([],Storage::disk('photo-ciphertext')->allFiles());
    }
    public function test_storage_api_requires_identity_and_never_exposes_object_paths():void {
        $this->getJson('/photos/v1/00000000-0000-4000-8000-000000000001/receipt')
          ->assertUnauthorized();
        $this->getJson('/photos/v1/00000000-0000-4000-8000-000000000001/manifests')
          ->assertUnauthorized();
    }
}
