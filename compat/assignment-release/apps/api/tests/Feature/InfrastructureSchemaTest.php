<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

final class InfrastructureSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_foundation_only_installs_infrastructure_tables(): void
    {
        foreach (['cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs'] as $table) {
            $this->assertTrue(Schema::hasTable($table), $table);
        }

        foreach (['users', 'password_reset_tokens', 'sessions'] as $table) {
            $this->assertFalse(Schema::hasTable($table), $table);
        }
    }
}
