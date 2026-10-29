<?php

return [
    // This temporary plaintext API can never be enabled in production.
    'enabled' => env('LOCAL_SERVER_PROTOTYPE_ENABLED', env('APP_ENV') === 'local'),
    'disk' => 's3',
    'max_bytes' => 512 * 1024 * 1024,
    'requests_per_minute' => 300,
    'max_photos' => 1000,
];
