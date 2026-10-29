<?php
return [
    'disk'=>'photo-ciphertext',
    // Default OFF until full two-account independent security/crypto/device acceptance.
    'recipient_thumbnail_reads_enabled'=>false,
    'account_quota_bytes'=>(int) env('PHOTO_ACCOUNT_QUOTA_BYTES',1073741824),
    'max_asset_bytes'=>134217728,
    'max_metadata_bytes'=>1048576,
    'orphan_grace_hours'=>24,
    'cleanup_batch'=>100,
    'cleanup_lease_minutes'=>15,
];
