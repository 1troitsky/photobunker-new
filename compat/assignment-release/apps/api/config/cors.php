<?php

// The application and API share one origin. Cross-origin API access is not a
// transport for cookies, recovery proofs or Matrix provisioning credentials.
return [
    'paths' => [],
    'allowed_methods' => [],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => [],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
