<?php

$secureCookie = filter_var(env('SESSION_SECURE_COOKIE', true), FILTER_VALIDATE_BOOL);

return [
    'driver' => env('SESSION_DRIVER','file'),
    'lifetime' => 1440,
    'expire_on_close' => false,
    'encrypt' => true,
    'files' => storage_path('framework/sessions'),
    'connection' => env('SESSION_CONNECTION'),
    'table' => 'sessions',
    'store' => env('SESSION_STORE'),
    'lottery' => [2, 100],
    // Browsers reject a __Host- cookie without Secure. Keep the hardened name in
    // HTTPS deployments and use an explicit host-only development name on HTTP.
    'cookie' => env('SESSION_COOKIE', $secureCookie ? '__Host-pb_session' : 'pb_session'),
    'path' => '/',
    'domain' => null,
    'secure' => $secureCookie,
    'http_only' => true,
    'same_site' => 'strict',
];
