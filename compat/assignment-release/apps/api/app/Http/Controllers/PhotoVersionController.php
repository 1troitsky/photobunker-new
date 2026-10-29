<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Objects;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

final class PhotoVersionController
{
    public function __construct(private readonly Keys $keys, private readonly Objects $objects, private readonly Workspace $workspace, private readonly Accounts $accounts) {}

    public function index(Request $r, string $id)
    {
        $actor = $this->accounts->current($r)->id;
        $this->keys->read($r);
        $row = $this->objects->active($actor, $id);
        abort_unless($this->workspace->grant($actor, $row)['read'], 403);
        $result = [];
        foreach (DB::table('encrypted_versions')->where('photo_id', $id)->orderBy('ordinal')->get() as $v) {
            $image = DB::table('encrypted_objects')->find($v->image_id);
            $meta = DB::table('encrypted_objects')->find($v->metadata_id);
            $packet = Protocol::decode($image->packet);
            if (! collect($packet['envelopes'])->contains(fn ($e) => $e['accountId'] === $actor)) {
                continue;
            }
            $result[] = ['id' => $v->id, 'event' => Protocol::decode($v->event), 'signature' => $v->signature, 'image' => $packet, 'metadata' => Protocol::decode($meta->packet), 'conflict' => (bool) $v->conflict];
        }

        return response()->json(['versions' => $result]);
    }

    public function save(Request $r, string $id)
    {
        $actor = $this->accounts->current($r)->id;
        $this->keys->read($r);
        $input = $r->validate(['event' => 'required|string|max:10000', 'signature' => 'required|string|max:100', 'packets' => 'required|string|max:500000', 'files' => 'required|array|size:2', 'files.image' => 'required|file|max:65600', 'files.metadata' => 'required|file|max:300']);
        $e = Protocol::decode($input['event'], 10000);
        $packets = Protocol::decode($input['packets'], 500000);
        Protocol::fields($e, ['version', 'id', 'photoId', 'parent', 'baseId', 'imageHash', 'metadataHash']);
        Validator::make($e, ['version' => 'required|integer|in:1', 'id' => 'required|uuid', 'photoId' => 'required|uuid', 'parent' => 'required|string|size:43', 'baseId' => 'present|nullable|uuid', 'imageHash' => 'required|string|size:43', 'metadataHash' => 'required|string|size:43'])->validate();
        Protocol::fields($packets, ['image', 'metadata']);
        $result = DB::transaction(function () use ($r, $actor, $id, $input, $e, $packets) {
            $row = $this->lock($actor, $id);
            abort_unless($this->workspace->grant($actor, $row)['edit'], 403);
            abort_unless($e['photoId'] === $id && $e['parent'] === $row->submission_hash, 422);
            $old = DB::table('encrypted_versions')->find($e['id']);
            if ($old) {
                if (! ($old->photo_id === $id && $old->event === $input['event'] && $old->signature === $input['signature'])) {
                    abort(response()->json(['code' => 'version_id_conflict'], 409));
                }

                return ['id' => $old->id, 'conflict' => (bool) $old->conflict];
            }
            if ($e['baseId']) {
                abort_unless(DB::table('encrypted_versions')->where('photo_id', $id)->where('id', $e['baseId'])->exists(), 422);
            }
            $head = DB::table('encrypted_versions')->where('photo_id', $id)->orderByDesc('ordinal')->value('id');
            $plan = $this->keys->plan($actor, $row->assignment_id, $packets['image']['plan'] ?? []);
            $total = 0;
            foreach (['image' => 'local-version', 'metadata' => 'version-metadata'] as $name => $kind) {
                $s = $this->objects->packet($r, $packets[$name], $plan, $id, $row->creator_id, $kind, 1, $row->submission_hash);
                abort_unless($e[$name.'Hash'] === Protocol::digest($packets[$name]), 422);
                $file = $r->file('files.'.$name);
                abort_unless($file->getSize() === (int) $s['ciphertextBytes'] && Protocol::ciphertextHash($file->getRealPath()) === $s['ciphertextHash'], 422);
                Protocol::framing($file->getRealPath(), $s['descriptor']);
                $total += $file->getSize();
            }
            Protocol::p256('editor-version', $e, $input['signature'], $packets['image']['certificate']['statement']['signingKey']);
            abort_unless($packets['image']['statement']['accountId'] === $packets['metadata']['statement']['accountId'], 422);
            $objectIds = [$packets['image']['statement']['descriptor']['object_id'], $packets['metadata']['statement']['descriptor']['object_id']];
            abort_unless(count(array_unique($objectIds)) === 2, 422);
            abort_if(DB::table('encrypted_objects')->whereIn('id', $objectIds)->exists(), 409);
            $this->quota($row, $total);
            foreach (['image' => 'local-version', 'metadata' => 'version-metadata'] as $name => $kind) {
                $this->store($row, $packets[$name]['statement']['descriptor']['object_id'], $kind, $r->file('files.'.$name), Protocol::canonical($packets[$name]));
            }
            abort_if($row->expires_at <= Retention::milliseconds(), 410);
            $conflict = $head !== $e['baseId'];
            DB::table('encrypted_versions')->insert(['id' => $e['id'], 'photo_id' => $id, 'image_id' => $packets['image']['statement']['descriptor']['object_id'], 'metadata_id' => $packets['metadata']['statement']['descriptor']['object_id'], 'creator_id' => $actor, 'event' => $input['event'], 'signature' => $input['signature'], 'conflict' => $conflict, 'ordinal' => (int) DB::table('encrypted_versions')->where('photo_id', $id)->max('ordinal') + 1, 'created_at' => now()]);

            return ['id' => $e['id'], 'conflict' => $conflict];
        });

        return response()->json($result);
    }

    public function lock(string $actor, string $id): object
    {
        $found = DB::table('encrypted_photos')->find($id);
        abort_unless($found, 404);
        $owner = DB::table('workspace_vaults')->where('id', $found->vault_id)->value('owner_id');
        DB::table('identity_accounts')->where('id', $owner)->lockForUpdate()->firstOrFail();
        DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
        if ($found->assignment_id) {
            DB::table('workspace_records')->where('id', $found->assignment_id)->lockForUpdate()->first();
        }
        DB::table('encrypted_photos')->where('id', $id)->lockForUpdate()->firstOrFail();

        return $this->objects->active($actor, $id);
    }

    public function quota(object $row, int $added): void
    {
        $owner = DB::table('workspace_vaults')->where('id', $row->vault_id)->value('owner_id');
        $vaults = DB::table('workspace_vaults')->where('owner_id', $owner)->select('id');
        $bytes = DB::table('encrypted_objects')->whereIn('photo_id', DB::table('encrypted_photos')->whereIn('vault_id', $vaults)->whereIn('state', ['active', 'pending'])->select('id'))->sum('bytes');
        $legacy = DB::table('workspace_photos')->whereIn('vault_id', $vaults)->whereIn('state', ['active', 'pending'])->sum(DB::raw('bytes + thumbnail_bytes + preview_bytes'));
        abort_if($bytes + $legacy + $added > config('prototype.max_bytes'), 413);
    }

    public function store(object $row, string $id, string $kind, UploadedFile $file, string $packet): void
    {
        $path = 'encrypted/'.$row->vault_id.'/'.$row->id.'/'.$id;
        $disk = Storage::disk(config('prototype.disk'));
        $stream = fopen($file->getRealPath(), 'rb');
        try {
            abort_unless($disk->put($path, $stream) && $disk->size($path) === $file->getSize(), 503);
        } catch (\Throwable) {
            abort(503);
        } finally {
            fclose($stream);
        }
        DB::table('encrypted_objects')->insert(['id' => $id, 'photo_id' => $row->id, 'kind' => $kind, 'revision' => 1, 'bytes' => $file->getSize(), 'object_key' => $path, 'packet' => $packet, 'created_at' => now()]);
    }
}
