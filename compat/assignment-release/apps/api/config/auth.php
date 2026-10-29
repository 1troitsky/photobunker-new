<?php

// Anonymous proof-of-possession authentication belongs to a later change.
// No email/password provider, password broker, or session guard is enabled.
return [
    'defaults' => ['guard' => null, 'passwords' => null],
    'guards' => [],
    'providers' => [],
    'passwords' => [],
];
