<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Objects;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class PhotoShareController
{
    public function __construct(private readonly Keys $keys, private readonly Objects $objects, private readonly Workspace $workspace, private readonly Accounts $accounts, private readonly PhotoVersionController $versions) {}

    public function index(Request $r, string $id)
    {
        $actor = $this->accounts->current($r)->id;
        $this->keys->read($r);
        $row = $this->objects->active($actor, $id);
        abort_unless($this->workspace->grant($actor, $row)['shareExternal'], 403);

        return response()->json(['shares' => DB::table('encrypted_shares')->where('photo_id', $id)->where('creator_id', $actor)->orderByDesc('created_at')->get()->map(function ($s) use ($row) {
            $m = Protocol::decode($s->manifest);
            if (($m['version'] ?? null) !== 1 || isset($m['type'])) {
                return null;
            }

            return ['id' => $s->id, 'scope' => $m['scope'], 'versionId' => $m['versionId'],
                'expiresAt' => min((int) $s->expires_at, (int) $row->expires_at), 'revoked' => (bool) $s->revoked_at];
        })->filter()->values()]);
    }

    public function create(Request $r, string $id)
    {
        $actor = $this->accounts->current($r)->id;
        $this->keys->read($r);
        $input = $r->validate(['manifest' => 'required|string|max:2000', 'file' => 'required|file|max:65600']);
        $m = Protocol::decode($input['manifest'], 2000);
        Protocol::fields($m, ['version', 'id', 'scope', 'versionId', 'expiresAt', 'iv', 'ciphertextHash', 'ciphertextBytes']);
        Validator::make($m, ['version' => 'required|integer|in:1', 'id' => 'required|uuid', 'scope' => 'required|in:view,download', 'versionId' => 'present|nullable|uuid', 'expiresAt' => 'required|integer|min:1|max:9007199254740991', 'iv' => 'required|string|size:16', 'ciphertextHash' => 'required|string|size:43', 'ciphertextBytes' => 'required|integer|min:17|max:67108880'])->validate();
        Protocol::bytes($m['iv'], 12);
        $file = $r->file('file');
        abort_unless($file->getSize() === $m['ciphertextBytes'] && Protocol::ciphertextHash($file->getRealPath()) === $m['ciphertextHash'], 422);
        $result = DB::transaction(function () use ($actor, $id, $input, $m, $file) {
            $row = $this->versions->lock($actor, $id);
            abort_unless($this->workspace->grant($actor, $row)['shareExternal'], 403);
            abort_unless($m['expiresAt'] <= $row->expires_at && $m['expiresAt'] > Retention::milliseconds(), 422);
            if ($m['versionId']) {
                abort_unless(DB::table('encrypted_versions')->where('photo_id', $id)->where('id', $m['versionId'])->exists(), 422);
            }
            $old = DB::table('encrypted_shares')->find($m['id']);
            if ($old) {
                abort_if($old->revoked_at, 410);
                abort_unless($old->creator_id === $actor && $old->photo_id === $id && $old->manifest === $input['manifest'], 409);

                return ['id' => $old->id, 'expiresAt' => (int) $old->expires_at];
            }
            $this->versions->quota($row, $file->getSize());
            $object = (string) Str::uuid();
            $this->versions->store($row, $object, 'share-export', $file, '{}');
            abort_if($row->expires_at <= Retention::milliseconds(), 410);
            DB::table('encrypted_shares')->insert(['id' => $m['id'], 'photo_id' => $id, 'object_id' => $object, 'creator_id' => $actor, 'manifest' => $input['manifest'], 'expires_at' => $m['expiresAt'], 'created_at' => now()]);

            return ['id' => $m['id'], 'expiresAt' => $m['expiresAt']];
        });

        return response()->json($result);
    }

    public function revoke(Request $r, string $id, string $shareId)
    {
        $actor = $this->accounts->current($r)->id;
        $this->keys->read($r);
        $s = DB::transaction(function () use ($actor, $id, $shareId) {
            $row = $this->versions->lock($actor, $id);
            $grant = $this->workspace->grant($actor, $row);
            $s = DB::table('encrypted_shares')->where('photo_id', $id)->where('id', $shareId)->first();
            abort_unless($s && ($s->creator_id === $actor || in_array($grant['role'], ['owner', 'curator'], true)), 404);
            DB::table('encrypted_shares')->where('id', $shareId)->update(['revoked_at' => now()]);

            return $s;
        });
        $ok = $this->cleanup($s);

        return response()->json(['revoked' => true, 'deletion' => $ok ? 'verified' : 'pending'], $ok ? 200 : 202);
    }

    private function publicShare(Request $r, string $id): object
    {
        // Coarse ephemeral IP bucket, no persistent fingerprint or request logging.
        $bucket = 'photo-share:'.hash('sha256', (string) $r->ip());
        abort_if(RateLimiter::tooManyAttempts($bucket, 120), 429);
        RateLimiter::hit($bucket, 60);
        $s = DB::table('encrypted_shares')->find($id);
        abort_unless($s, 404);
        $row = DB::table('encrypted_photos')->find($s->photo_id);
        abort_if(! $row || $s->revoked_at || $row->state !== 'active' || min((int) $s->expires_at, (int) $row->expires_at) <= Retention::milliseconds(), 410);
        try {
            $grant = $this->workspace->grant($s->creator_id, $row);
        } catch (HttpException) {
            abort(410);
        }
        abort_unless($grant['shareExternal'], 410);

        return $s;
    }

    public function show(Request $r, string $id)
    {
        $s = $this->publicShare($r, $id);
        $manifest = Protocol::decode($s->manifest);
        abort_unless(($manifest['version'] ?? null) === 1 && ! isset($manifest['type']), 404);

        return response()->json($manifest, 200, ['Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer']);
    }

    public function content(Request $r, string $id)
    {
        $s = $this->publicShare($r, $id);
        $manifest = Protocol::decode($s->manifest);
        abort_unless(($manifest['version'] ?? null) === 1 && ! isset($manifest['type']), 404);
        $o = DB::table('encrypted_objects')->find($s->object_id);
        try {
            $stream = Storage::disk(config('prototype.disk'))->readStream($o->object_key);
        } catch (\Throwable) {
            abort(503);
        }
        abort_unless(is_resource($stream), 503);

        return response()->stream(function () use ($stream) {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, ['Content-Type' => 'application/octet-stream', 'Content-Length' => (string) $o->bytes, 'Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer']);
    }

    public function cleanup(object $s): bool
    {
        $objectIds = collect([$s->object_id]);
        if (Schema::hasTable('photo_card_share_objects')) {
            $objectIds = $objectIds->merge(
                DB::table('photo_card_share_objects')->where('share_id', $s->id)->pluck('object_id')
            );
        }
        $deleted = true;
        foreach ($objectIds->filter()->unique() as $objectId) {
            $o = DB::table('encrypted_objects')->find($objectId);
            if (! $o || (int) $o->bytes === 0) {
                continue;
            }
            try {
                $disk = Storage::disk(config('prototype.disk'));
                $disk->delete($o->object_key);
                if ($disk->exists($o->object_key)) {
                    $deleted = false;

                    continue;
                }
                DB::table('encrypted_objects')->where('id', $o->id)->update(['bytes' => 0]);
            } catch (\Throwable) {
                $deleted = false;
            }
        }

        return $deleted;
    }
}
