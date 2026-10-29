<?php

namespace App\Identity;

final class Proof
{
    public static function decode(string $value): string|false
    {
        if (! preg_match('/^[A-Za-z0-9_-]+$/D', $value)) {
            return false;
        }

        $decoded = base64_decode(strtr($value, '-_', '+/').str_repeat('=', (4 - strlen($value) % 4) % 4), true);

        return $decoded !== false && rtrim(strtr(base64_encode($decoded), '+/', '-_'), '=') === $value ? $decoded : false;
    }

    public static function publicKey(string $value): \OpenSSLAsymmetricKey
    {
        $der = self::decode($value);
        $key = $der === false ? false : @openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n").'-----END PUBLIC KEY-----');
        $details = $key ? openssl_pkey_get_details($key) : false;
        abort_unless($details && $details['type'] === OPENSSL_KEYTYPE_EC && ($details['ec']['curve_name'] ?? '') === 'prime256v1', 422);

        $canonical = base64_decode(preg_replace('/-----[^-]+-----|\s/', '', $details['key']));
        abort_unless(strlen($der) === 91 && hash_equals($canonical, $der), 422);

        return $key;
    }

    public static function verify(string $publicKey, string $message, string $signature): bool
    {
        $raw = self::decode($signature);
        if ($raw === false || strlen($raw) !== 64) {
            return false;
        }
        // WebCrypto ECDSA is P1363 (r || s); OpenSSL expects ASN.1 DER.
        $integer = static function (string $bytes): string {
            $bytes = ltrim($bytes, "\0") ?: "\0";
            if (ord($bytes[0]) & 128) {
                $bytes = "\0".$bytes;
            }

            return "\x02".chr(strlen($bytes)).$bytes;
        };
        $parts = $integer(substr($raw, 0, 32)).$integer(substr($raw, 32));

        return openssl_verify($message, "\x30".chr(strlen($parts)).$parts, self::publicKey($publicKey), OPENSSL_ALGO_SHA256) === 1;
    }

    public static function canonical(array $payload): string
    {
        ksort($payload);

        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);
    }
}
