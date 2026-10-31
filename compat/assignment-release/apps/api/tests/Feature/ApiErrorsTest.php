<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

final class ApiErrorsTest extends TestCase
{
    public function test_unknown_route_has_safe_json_error_and_security_headers(): void
    {
        $response = $this->get('/api/v1/unknown', ['Accept' => 'text/html']);

        $response->assertNotFound()
            ->assertJsonPath('error.code', 'resource.not_found')
            ->assertJsonPath('error.retryable', false)
            ->assertHeader('Content-Type', 'application/json')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Referrer-Policy', 'no-referrer')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    public function test_debug_mode_does_not_expose_exception_secrets_or_log_them(): void
    {
        config(['app.debug' => true]);
        Log::spy();
        Route::get('/api/v1/test-error', function (): never {
            throw new RuntimeException('secret-recovery-key secret-s3-key');
        });

        $response = $this->getJson('/api/v1/test-error');

        $response->assertStatus(500)
            ->assertJsonPath('error.code', 'server.error')
            ->assertJsonPath('error.retryable', true);
        $this->assertStringNotContainsString('secret-recovery-key', $response->getContent());
        $this->assertStringNotContainsString('secret-s3-key', $response->getContent());
        $this->assertStringNotContainsString('trace', $response->getContent());

        Log::shouldHaveReceived('error')->once()->with('api.exception', [
            'exception_type' => RuntimeException::class,
            'request_id' => $response->json('error.request_id'),
        ]);
    }

    public function test_untrusted_request_id_is_replaced(): void
    {
        $first = $this->getJson('/api/v1/health', ['X-Request-ID' => 'secret-injected-id']);
        $second = $this->getJson('/api/v1/health');

        $first->assertOk();
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $first->headers->get('X-Request-ID'),
        );
        $this->assertNotSame($first->headers->get('X-Request-ID'), $second->headers->get('X-Request-ID'));
    }
}
