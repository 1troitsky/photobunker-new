<?php

namespace App\Encrypted;

use App\Identity\Proof;
use Illuminate\Support\Facades\Validator;

final class Protocol
{
    // The signed schemas deliberately have ASCII keys and safe integer counters.
    // No floats or arbitrary user keys enter this cross-language canonical domain.
    public static function canonical(mixed $value): string
    {
        if (is_object($value)) {
            $value = get_object_vars($value);
        }
        if (is_array($value)) {
            if (array_is_list($value)) {
                return '['.implode(',', array_map(self::canonical(...), $value)).']';
            }
            foreach (array_keys($value) as $key) {
                abort_unless(is_string($key) && preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $key), 422);
            }
            ksort($value, SORT_STRING);

            return '{'.implode(',', array_map(fn ($key) => self::canonical($key).':'.self::canonical($value[$key]), array_keys($value))).'}';
        }
        abort_unless(is_string($value) || is_bool($value) || $value === null || is_int($value) && abs($value) <= 9007199254740991, 422);

        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);
    }

    public static function decode(string $json, int $maximum = 1048576): array
    {
        abort_if(strlen($json) > $maximum, 422);
        try {
            $value = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(422);
        }
        abort_unless(is_array($value) && hash_equals(self::canonical($value), $json), 422);

        return $value;
    }

    public static function fields(array $value, array $required, array $optional = []): void
    {
        abort_unless(array_diff($required, array_keys($value)) === [] && array_diff(array_keys($value), [...$required, ...$optional]) === [], 422);
    }

    public static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function bytes(string $value, ?int $length = null): string
    {
        $bytes = Proof::decode($value);
        abort_unless($bytes !== false && ($length === null || strlen($bytes) === $length), 422);

        return $bytes;
    }

    public static function digest(mixed $value): string
    {
        return self::b64(sodium_crypto_generichash(is_string($value) ? $value : self::canonical($value), '', 32));
    }

    public static function message(string $purpose, array $value): string
    {
        return 'photobunker/'.$purpose."/v1\0".self::canonical($value);
    }

    public static function ed(string $purpose, array $value, string $signature, string $publicKey): void
    {
        abort_unless(sodium_crypto_sign_verify_detached(self::bytes($signature, 64), self::message($purpose, $value), self::bytes($publicKey, 32)), 422);
    }

    public static function p256(string $purpose, array $value, string $signature, string $publicKey): void
    {
        abort_unless(Proof::verify($publicKey, self::message($purpose, $value), $signature), 422);
    }

    public static function key(array $doc, object $account): void
    {
        self::fields($doc, ['record', 'signature', 'binding', 'rootSignature', 'rootKey']);
        Validator::make($doc, ['record' => 'required|array:version,accountId,publicId,authorityKey,recipientKey,pendingKey,readKey,revision,previousHash,recoveryId,bundleHash', 'signature' => 'required|string', 'binding' => 'required|array:version,accountId,authorityKey', 'rootSignature' => 'required|string', 'rootKey' => 'required|string'])->validate();
        $r = Validator::make($doc['record'], ['version' => 'required|integer|in:1', 'accountId' => 'required|uuid', 'publicId' => 'required|string', 'authorityKey' => 'required|string', 'recipientKey' => 'required|string', 'pendingKey' => 'required|string', 'readKey' => 'required|string', 'revision' => 'required|integer|min:1|max:100000', 'previousHash' => 'present|string', 'recoveryId' => 'required|uuid', 'bundleHash' => 'required|string'])->validate();
        abort_unless($r['accountId'] === $account->id && $r['publicId'] === $account->public_id && $doc['rootKey'] === $account->public_key && $doc['binding'] === ['accountId' => $r['accountId'], 'authorityKey' => $r['authorityKey'], 'version' => 1], 422);
        abort_unless($r['authorityKey'] !== $r['readKey'] && $r['recipientKey'] !== $r['pendingKey'], 422);
        foreach (['authorityKey', 'recipientKey', 'pendingKey', 'readKey', 'bundleHash'] as $field) {
            self::bytes($r[$field], 32);
        }
        self::p256('photo-authority', $doc['binding'], $doc['rootSignature'], $account->public_key);
        self::ed('photo-key', $r, $doc['signature'], $r['authorityKey']);
    }

    public static function framing(string $path, array $descriptor): void
    {
        $stream = fopen($path, 'rb');
        abort_unless(is_resource($stream), 503);
        $size = filesize($path);
        try {
            $prefix = fread($stream, 12);
            abort_unless(strlen($prefix) === 12 && substr($prefix, 0, 8) === 'PBOBJ001', 422);
            $length = unpack('N', substr($prefix, 8))[1];
            abort_unless($length > 0 && $length <= 65536, 422);
            $encoded = fread($stream, $length);
            abort_unless($encoded === self::canonical($descriptor) && strlen(fread($stream, 24)) === 24, 422);
            $total = 0;
            $plain = (int) $descriptor['plaintext_bytes'];
            for ($i = 0; $i < $descriptor['frame_count']; $i++) {
                $bytes = fread($stream, 4);
                abort_unless(strlen($bytes) === 4, 422);
                $frame = unpack('N', $bytes)[1];
                $count = min(1048576, $plain - $total);
                abort_unless($frame === $count + 17 && ftell($stream) + $frame <= $size && fseek($stream, $frame, SEEK_CUR) === 0, 422);
                $total += $count;
            }
            abort_unless($total === $plain && ftell($stream) === $size, 422);
        } finally {
            fclose($stream);
        }
    }

    public static function ciphertextHash(string $path): string
    {
        $state = sodium_crypto_generichash_init('', 32);
        $stream = fopen($path, 'rb');
        try {
            while (! feof($stream)) {
                $chunk = fread($stream, 1048576);
                abort_unless($chunk !== false, 503);
                sodium_crypto_generichash_update($state, $chunk);
            }
        } finally {
            fclose($stream);
        }

        return self::b64(sodium_crypto_generichash_final($state, 32));
    }
}
