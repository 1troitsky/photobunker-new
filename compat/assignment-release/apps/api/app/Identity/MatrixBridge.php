<?php

namespace App\Identity;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

final class MatrixBridge
{
    private function cacheKey(string $suffix): string
    {
        return 'matrix:'.hash('sha256', config('identity.matrix_url')).':'.$suffix;
    }

    private function request(string $method, string $path, array $data = [], ?string $token = null): array
    {
        $client = Http::baseUrl(config('identity.matrix_url'))->acceptJson()->connectTimeout(2)->timeout(8);
        if ($token) {
            $client = $client->withToken($token);
        }
        $response = $client->send($method, $path, $data ? ['json' => $data] : []);
        if ($method === 'DELETE' && $response->status() === 404) {
            return [];
        }
        if (! $response->successful()) {
            $code = $response->json('errcode');
            $code = is_string($code) && preg_match('/^M_[A-Z_]+$/D', $code) ? $code : 'M_UNKNOWN';
            $stage = str_contains($path, '/register') ? 'register' : (str_contains($path, '/login') ? 'login' : 'admin_'.$method);
            throw new MatrixFailure('matrix.'.$stage.'.'.$response->status().'.'.$code.($response->status() === 429 ? '.retry_ms_'.(int) $response->json('retry_after_ms', 0) : ''));
        }

        return $response->json() ?? [];
    }

    public function healthy(): bool
    {
        try {
            return isset($this->request('GET', '/_matrix/client/versions')['versions']);
        } catch (\Throwable) {
            return false;
        }
    }

    public function mxid(string $account): string
    {
        return '@pb_'.str_replace('-', '', $account).':'.config('identity.matrix_server');
    }

    private function register(string $name, string $password, bool $admin): array
    {
        $secret = config('identity.matrix_secret');
        if (! $secret) {
            throw new \RuntimeException('matrix.unconfigured');
        }
        $nonce = $this->request('GET', '/_synapse/admin/v1/register')['nonce'];
        $mac = hash_hmac('sha1', $nonce."\0".$name."\0".$password."\0".($admin ? 'admin' : 'notadmin'), $secret);

        return $this->request('POST', '/_synapse/admin/v1/register', ['nonce' => $nonce, 'username' => $name, 'password' => $password, 'admin' => $admin, 'inhibit_login' => true, 'mac' => $mac]);
    }

    private function login(string $user, string $password, string $device): array
    {
        $result = $this->request('POST', '/_matrix/client/v3/login', ['type' => 'm.login.password', 'identifier' => ['type' => 'm.id.user', 'user' => $user], 'password' => $password, 'device_id' => $device, 'initial_device_display_name' => 'PhotoBunker']);
        if (($result['user_id'] ?? '') !== $user || ($result['device_id'] ?? '') !== $device) {
            throw new \RuntimeException('matrix.binding');
        }

        return $result;
    }

    private function admin(): string
    {
        return Cache::lock('matrix:bootstrap', 60)->block(10, function (): string {
            $cached = Cache::get($this->cacheKey('admin:token'));
            if ($cached) {
                $token = Crypt::decryptString($cached);
                try {
                    $this->request('GET', '/_matrix/client/v3/account/whoami', [], $token);

                    return $token;
                } catch (MatrixFailure $error) {
                    if (! str_contains($error->getMessage(), '.401.')) {
                        throw $error;
                    } Cache::forget($this->cacheKey('admin:token'));
                }
            }
            $name = 'photobunker_service_admin';
            $user = '@'.$name.':'.config('identity.matrix_server');
            $password = config('identity.matrix_admin_password');
            if (! $password) {
                throw new \RuntimeException('matrix.unconfigured');
            }
            try {
                $this->register($name, $password, true);
            } catch (MatrixFailure $error) {
                if (! str_ends_with($error->getMessage(), '.M_USER_IN_USE')) {
                    throw $error;
                }
            }
            $token = $this->login($user, $password, 'PB_SERVICE')['access_token'];
            Cache::put($this->cacheKey('admin:token'), Crypt::encryptString($token), now()->addHour());

            return $token;

        });
    }

    public function provision(string $id): void
    {
        Cache::lock('matrix:account:'.$id, 90)->block(10, function () use ($id): void {
            $account = DB::table('identity_accounts')->find($id);
            if (! $account || $account->deletion_requested_at || $account->matrix_state === 'ready') {
                return;
            }
            $admin = $this->admin(); // Bootstrap before any ordinary account.
            $mxid = $this->mxid($id);
            try {
                $registered = $this->register('pb_'.str_replace('-', '', $id), Crypt::decryptString($account->matrix_password), false);
            } catch (MatrixFailure $error) {
                if (! str_ends_with($error->getMessage(), '.M_USER_IN_USE')) {
                    throw $error;
                } $registered = [];
            }
            if (! empty($registered['device_id'])) {
                $this->request('DELETE', '/_synapse/admin/v2/users/'.rawurlencode($mxid).'/devices/'.rawurlencode($registered['device_id']), [], $admin);
            }
            $state = $this->request('GET', '/_synapse/admin/v2/users/'.rawurlencode($mxid), [], $admin);
            if (($state['admin'] ?? true) || ($state['name'] ?? '') !== $mxid) {
                throw new \RuntimeException('matrix.binding');
            }
            DB::table('identity_accounts')->where('id', $id)->update(['matrix_state' => 'ready']);
        });
    }

    public function deviceId(object $device): string
    {
        return $device->matrix_device_id ?: 'PB_'.str_replace('-', '', $device->id);
    }

    public function session(string $accountId, string $deviceId): array
    {
        // Complete any earlier logout before minting a token for a new crypto identity.
        $this->revoke($deviceId);

        return Cache::lock('matrix:device:'.$deviceId, 120)->block(10, function () use ($accountId, $deviceId): array {
            $device = DB::table('identity_devices')->where('id', $deviceId)->where('account_id', $accountId)->whereNull('revoked_at')->first();
            abort_unless($device, 401);
            abort_if($device->matrix_revoke_pending, 503);
            $matrixDevice = $this->deviceId($device);
            $this->provision($accountId);
            $account = DB::table('identity_accounts')->find($accountId);
            $cacheKey = $this->cacheKey('token:'.$deviceId);
            $cached = Cache::get($cacheKey);
            $result = null;
            if ($cached) {
                $token = Crypt::decryptString($cached);
                try {
                    $who = $this->request('GET', '/_matrix/client/v3/account/whoami', [], $token);
                    $result = ['user_id' => $who['user_id'], 'device_id' => $who['device_id'], 'access_token' => $token];
                } catch (MatrixFailure $error) {
                    if (! str_contains($error->getMessage(), '.401.')) {
                        throw $error;
                    } Cache::forget($cacheKey);
                }
            }
            $result ??= $this->login($this->mxid($accountId), Crypt::decryptString($account->matrix_password), $matrixDevice);
            if ($result['user_id'] !== $this->mxid($accountId) || $result['device_id'] !== $matrixDevice) {
                throw new MatrixFailure('matrix.binding');
            }
            Cache::put($cacheKey, Crypt::encryptString($result['access_token']), now()->addHour());

            // Revocation may have committed during the external call.
            if (DB::table('identity_devices')->where('id', $deviceId)->whereNotNull('revoked_at')->exists()) {
                // The revoker waits on this device lock, then deletes any token
                // minted by this call. Keep its durable intent until then.
                DB::table('identity_devices')->where('id', $deviceId)->update(['matrix_revoke_pending' => true]);
                abort(401);
            }

            return ['userId' => $result['user_id'], 'deviceId' => $result['device_id'], 'accessToken' => $result['access_token'], 'baseUrl' => '/'];
        });
    }

    public function uploadSigningKeys(string $accountId, string $deviceId, array $keys): void
    {
        Cache::lock('matrix:signing:'.$accountId, 120)->block(10, function () use ($accountId, $deviceId, $keys): void {
            $session = $this->session($accountId, $deviceId);
            $mxid = $this->mxid($accountId);
            $known = $this->request('POST', '/_matrix/client/v3/keys/query', ['device_keys' => [$mxid => []]], $session['accessToken']);
            $master = $known['master_keys'][$mxid]['keys'] ?? null;
            // Recovery imports existing secrets. Never silently replace a known identity.
            abort_if($master && $master !== $keys['master_key']['keys'], 409);
            $client = Http::baseUrl(config('identity.matrix_url'))->acceptJson()->withToken($session['accessToken'])->connectTimeout(2)->timeout(8);
            $response = $client->post('/_matrix/client/v3/keys/device_signing/upload', $keys);
            if ($response->status() === 401) {
                $uia = $response->json('session');
                $flows = $response->json('flows', []);
                abort_unless(is_string($uia) && strlen($uia) <= 256 && collect($flows)->contains(fn ($flow) => in_array('m.login.password', $flow['stages'] ?? [], true)), 503);
                $account = DB::table('identity_accounts')->find($accountId);
                $response = $client->post('/_matrix/client/v3/keys/device_signing/upload', [...$keys, 'auth' => ['type' => 'm.login.password', 'session' => $uia, 'identifier' => ['type' => 'm.id.user', 'user' => $mxid], 'password' => Crypt::decryptString($account->matrix_password)]]);
            }
            abort_unless($response->successful(), 503);
        });
    }

    /** Backend-only metadata device: no crypto keys, signing secrets or media uploads. */
    public function workspaceRequest(string $accountId, string $method, string $path, array $data = []): array
    {
        abort_unless(str_starts_with($path, '/_matrix/client/v3/'), 500);
        $token = Cache::lock('matrix:workspace:'.$accountId, 90)->block(10, function () use ($accountId): string {
            $this->provision($accountId);
            $key = $this->cacheKey('workspace:'.$accountId);
            $cached = Cache::get($key);
            if ($cached) {
                $token = Crypt::decryptString($cached);
                try {
                    $who = $this->request('GET', '/_matrix/client/v3/account/whoami', [], $token);
                    if (($who['user_id'] ?? '') === $this->mxid($accountId) && ($who['device_id'] ?? '') === 'PB_WORKSPACE') {
                        return $token;
                    }
                } catch (MatrixFailure $error) {
                    if (! str_contains($error->getMessage(), '.401.')) {
                        throw $error;
                    }
                }
                Cache::forget($key);
            }
            $account = DB::table('identity_accounts')->find($accountId);
            abort_unless($account, 404);
            $token = $this->login($this->mxid($accountId), Crypt::decryptString($account->matrix_password), 'PB_WORKSPACE')['access_token'];
            Cache::put($key, Crypt::encryptString($token), now()->addHour());

            return $token;
        });

        return $this->request($method, $path, $data, $token);
    }

    public function forgetSessionCache(string $deviceId): void
    {
        Cache::forget($this->cacheKey('token:'.$deviceId));
    }

    public function deleteSyntheticAccount(string $id): void
    {
        $mxid = $this->mxid($id);
        try {
            $this->request('POST', '/_synapse/admin/v1/deactivate/'.rawurlencode($mxid), ['erase' => true], $this->admin());
        } catch (MatrixFailure $error) {
            if (! str_contains($error->getMessage(), '.404.')) {
                throw $error;
            }
        }
        Cache::forget($this->cacheKey('workspace:'.$id));
        foreach (DB::table('identity_devices')->where('account_id', $id)->pluck('id') as $device) {
            $this->forgetSessionCache($device);
        }
    }

    public function eraseAccount(string $id): void
    {
        $mxid = $this->mxid($id);
        $admin = $this->admin();
        try {
            $details = $this->request('GET', '/_synapse/admin/v2/users/'.rawurlencode($mxid), [], $admin);
        } catch (MatrixFailure $error) {
            // An unknown user is different from an unsupported deletion API.
            if (str_contains($error->getMessage(), '.404.M_NOT_FOUND')) {
                return;
            }
            throw $error;
        }
        if (! ($details['deactivated'] ?? false)) {
            // Deactivation erases account data and devices, but does not delete
            // Megolm backup versions. Remove those explicitly while still active.
            $token = $this->request('POST', '/_synapse/admin/v1/users/'.rawurlencode($mxid).'/login', ['valid_until_ms' => now()->addMinute()->getTimestampMs()], $admin)['access_token'];
            $finished = false;
            for ($i = 0; $i < 100; $i++) {
                try {
                    $version = $this->request('GET', '/_matrix/client/v3/room_keys/version', [], $token)['version'];
                } catch (MatrixFailure $error) {
                    if (! str_contains($error->getMessage(), '.404.M_NOT_FOUND')) {
                        throw $error;
                    }
                    $finished = true;
                    break;
                }
                $this->request('DELETE', '/_matrix/client/v3/room_keys/version/'.rawurlencode($version), [], $token);
            }
            if (! $finished) {
                throw new MatrixFailure('matrix.erase_pending');
            }
        }
        $this->request('POST', '/_synapse/admin/v1/deactivate/'.rawurlencode($mxid), ['erase' => true], $admin);
        $details = $this->request('GET', '/_synapse/admin/v2/users/'.rawurlencode($mxid), [], $admin);
        $devices = $this->request('GET', '/_synapse/admin/v2/users/'.rawurlencode($mxid).'/devices', [], $admin);
        if (($details['deactivated'] ?? false) !== true || ! isset($devices['devices']) || count($devices['devices']) !== 0) {
            throw new MatrixFailure('matrix.erase_unverified');
        }
        Cache::forget($this->cacheKey('workspace:'.$id));
        foreach (DB::table('identity_devices')->where('account_id', $id)->pluck('id') as $device) {
            $this->forgetSessionCache($device);
        }
    }

    public function revoke(string $deviceId): void
    {
        Cache::lock('matrix:device:'.$deviceId, 120)->block(10, function () use ($deviceId): void {
            $device = DB::table('identity_devices')->find($deviceId);
            if (! $device || ! $device->matrix_revoke_pending) {
                return;
            }
            $this->forgetSessionCache($deviceId);
            $account = DB::table('identity_accounts')->find($device->account_id);
            if ($account->matrix_state === 'ready') {
                $this->request('DELETE', '/_synapse/admin/v2/users/'.rawurlencode($this->mxid($device->account_id)).'/devices/'.rawurlencode($this->deviceId($device)), [], $this->admin());
            }
            DB::table('identity_devices')->where('id', $deviceId)->update(['matrix_revoke_pending' => false, 'matrix_device_id' => $device->revoked_at ? $device->matrix_device_id : 'PB_'.str_replace('-', '', $deviceId).'_'.strtolower(Str::random(12))]);
        });
    }
}
