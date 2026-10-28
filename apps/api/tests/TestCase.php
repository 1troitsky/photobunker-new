<?php
namespace Tests;
use Illuminate\Foundation\Testing\TestCase as Base;

abstract class TestCase extends Base
{
    public function createApplication()
    {
        $app = parent::createApplication();
        $app['config']->set('app.url', 'https://localhost');
        $app['config']->set('database.default', 'sqlite');
        $app['config']->set('database.connections.sqlite.database', ':memory:');
        $app['config']->set('session.driver', 'array');
        $app['config']->set('cache.default', 'array');

        return $app;
    }
}
