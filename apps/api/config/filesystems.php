<?php
return [
    'default' => 'local',
    'disks' => [
        'local' => ['driver'=>'local','root'=>storage_path('app/private'),'serve'=>false,'throw'=>true],
        'photo-ciphertext' => [
            'driver'=>'s3',
            'key'=>env('PHOTO_S3_ACCESS_KEY',''),
            'secret'=>env('PHOTO_S3_SECRET_KEY',''),
            'credentials'=>['key'=>env('PHOTO_S3_ACCESS_KEY',''),'secret'=>env('PHOTO_S3_SECRET_KEY','')],
            'region'=>env('PHOTO_S3_REGION','garage'),
            'bucket'=>env('PHOTO_S3_BUCKET','photobunker-new'),
            'endpoint'=>env('PHOTO_S3_ENDPOINT'),
            'use_path_style_endpoint'=>true,
            'throw'=>true,'report'=>false,
            'http'=>['connect_timeout'=>3,'timeout'=>25],
        ],
    ],
    // No public disks, symlinks or browser-facing presigned URLs.
    'links'=>[],
];
