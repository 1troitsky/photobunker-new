<?php

return [
    'enabled' => env('RTC_ENABLED', false),
    'jwt_url' => 'http://rtc-jwt:8080',
    'sfu_url' => 'http://livekit:7880',
    'key' => env('RTC_LIVEKIT_KEY', ''),
    'secret' => env('RTC_LIVEKIT_SECRET', ''),
];
