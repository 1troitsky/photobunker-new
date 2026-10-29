<?php

return [
    'default' => env('FILESYSTEM_DISK', 's3'),
    'cors_allowed_origins' => array_values(array_filter(array_map(
        'trim', explode(',', (string) env('AWS_CORS_ALLOWED_ORIGINS', 'http://localhost:5173'))
    ))),

    'disks' => [
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => false,
            'throw' => true,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            // Never fall back to host AWS profiles or instance metadata.
            'credentials' => [
                'key' => env('AWS_ACCESS_KEY_ID', ''),
                'secret' => env('AWS_SECRET_ACCESS_KEY', ''),
            ],
            'region' => env('AWS_DEFAULT_REGION', 'garage'),
            'bucket' => env('AWS_BUCKET', 'photobunker'),
            'endpoint' => env('AWS_ENDPOINT', 'http://garage:3900'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
            'throw' => true,
            'report' => false,
            'http' => [
                'connect_timeout' => 3,
                'timeout' => 10,
            ],
        ],
        // Only use this disk to generate URLs for the browser, never from jobs.
        's3-browser' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'credentials' => [
                'key' => env('AWS_ACCESS_KEY_ID', ''),
                'secret' => env('AWS_SECRET_ACCESS_KEY', ''),
            ],
            'region' => env('AWS_DEFAULT_REGION', 'garage'),
            'bucket' => env('AWS_BUCKET', 'photobunker'),
            'endpoint' => env('AWS_BROWSER_ENDPOINT', 'http://localhost:3900'),
            'use_path_style_endpoint' => true,
            'throw' => true,
            'report' => false,
        ],
    ],

    // Storage contains private opaque objects; no public storage symlink.
    'links' => [],
];
