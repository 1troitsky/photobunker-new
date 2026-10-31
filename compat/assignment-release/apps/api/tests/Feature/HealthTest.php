<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use Tests\TestCase;

final class HealthTest extends TestCase
{
    public function test_liveness_does_not_need_the_database_or_storage(): void
    {
        DB::shouldReceive('connection')->never();

        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertExactJson(['status' => 'ok'])
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Referrer-Policy', 'no-referrer');
    }

    public function test_readiness_checks_the_database(): void
    {
        $this->getJson('/api/v1/ready')
            ->assertOk()
            ->assertExactJson(['status' => 'ready']);
    }

    public function test_unavailable_database_returns_retryable_error_without_connection_details(): void
    {
        $connection = Mockery::mock();
        $connection->shouldReceive('select')->once()->with('select 1')
            ->andThrow(new RuntimeException('postgres://admin:secret-db-password@private-host/vault'));
        DB::shouldReceive('connection')->once()->andReturn($connection);

        $response = $this->getJson('/api/v1/ready');

        $response->assertStatus(503)
            ->assertJsonPath('error.code', 'service.unavailable')
            ->assertJsonPath('error.retryable', true)
            ->assertHeader('Retry-After', '5')
            ->assertHeader('X-Request-ID', $response->json('error.request_id'));
        $this->assertStringNotContainsString('secret-db-password', $response->getContent());
        $this->assertStringNotContainsString('private-host', $response->getContent());
        $this->assertStringNotContainsString('trace', $response->getContent());
    }
}
