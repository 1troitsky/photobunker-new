<?php

namespace Tests\Feature;

use Tests\TestCase;

final class TestRuntimeTest extends TestCase
{
    public function test_test_runtime_uses_isolated_memory_database(): void
    {
        $this->assertSame(['testing', 'sqlite', true, 'array'], [app()->environment(), config('database.default'), config('database.connections.sqlite.database') === ':memory:', config('cache.default')]);
    }
}
