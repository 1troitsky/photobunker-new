<?php

$configuredOrigins = array_map(
    static fn (string $origin): string => rtrim(trim($origin), '/'),
    explode(',', (string) env('IDENTITY_ORIGINS', '')),
);
$applicationOrigin = rtrim((string) env('APP_URL', ''), '/');
$localOrigins = in_array((string) env('APP_ENV', 'production'), ['local', 'testing'], true)
    ? ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://photobunker.orb.local', 'https://photobunker.orb.local']
    : [];

return [
    'enabled' => env('IDENTITY_ENABLED', true),
    // The deployed same-origin app is always accepted through APP_URL.
    // IDENTITY_ORIGINS only adds explicitly trusted aliases (for example a
    // second local hostname); it never enables wildcard browser origins.
    'origins' => array_values(array_unique(array_filter([
        $applicationOrigin,
        ...$configuredOrigins,
        ...$localOrigins,
    ]))),
    'read_requests_per_minute' => 1200,
    'write_requests_per_minute' => 180,
    'session_minutes' => 60 * 24 * 400,
    'matrix_url' => env('MATRIX_INTERNAL_URL', 'http://matrix:8008'),
    'matrix_server' => env('MATRIX_SERVER_NAME', 'matrix.photobunker.test'),
    'matrix_secret' => env('MATRIX_REGISTRATION_SECRET', ''),
    'matrix_admin_password' => env('MATRIX_BOOTSTRAP_PASSWORD', ''),
];
