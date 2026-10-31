<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Migration;
use App\Encrypted\Objects;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class EncryptedPhotoController
{
    public function __construct(private readonly Keys $keys, private readonly Objects $objects, private readonly Workspace $workspace, private readonly Accounts $accounts) {}

    private function actor(Request $request): string
    {
        return $this->accounts->current($request)->id;
    }

    public function upload(Request $request)
    {
        $actor = $this->actor($request);
        abort_unless($this->keys->enabled($actor), 409);
        $data = $request->validate(['submission' => 'required|string|max:20000', 'signature' => 'required|string|max:100', 'packets' => 'required|string|max:4194304', 'files' => 'required|array|size:5', 'files.*' => 'required|file|max:65600']);
        $s = Protocol::decode($data['submission'], 20000);
        $packets = Protocol::decode($data['packets'], 4194304);
        Validator::make($s, ['version' => 'required|integer|in:1', 'id' => 'required|uuid', 'creatorId' => 'required|uuid', 'deviceId' => 'required|uuid', 'vaultId' => 'required|uuid', 'assignmentId' => 'present|nullable|uuid', 'epoch' => 'required|integer|min:1', 'planHash' => 'required|string|size:43', 'anchor' => 'required|uuid', 'retentionSeconds' => 'required|integer|min:3600|max:1209600', 'expiresAt' => 'required|integer|min:1|max:9007199254740991', 'packetHashes' => 'required|array|size:5'])->validate();
        abort_unless($s['creatorId'] === $actor && $s['deviceId'] === $request->attributes->get('identity')->device_id, 422);
        Protocol::fields($s, ['version', 'id', 'creatorId', 'deviceId', 'vaultId', 'assignmentId', 'epoch', 'planHash', 'anchor', 'retentionSeconds', 'expiresAt', 'packetHashes'], ['initial', 'migration']);
        if (isset($s['migration'])) {
            $this->keys->read($request);
            app(Migration::class)->upload($actor, $s);
        }
        if (isset($s['initial'])) {
            $this->keys->read($request);
            $i = $s['initial'];
            Protocol::fields($i, ['statement', 'signature', 'certificate']);
            $old = $i['statement'];
            abort_unless(! isset($old['initial']) && $old['id'] === $s['id'] && $old['vaultId'] === $s['vaultId'] && $old['assignmentId'] === $s['assignmentId'] && $old['creatorId'] === $actor && $old['anchor'] === $s['anchor'] && $old['expiresAt'] === $s['expiresAt'] && $old['retentionSeconds'] === $s['retentionSeconds'] && $old['epoch'] <= $s['epoch'] && $i['certificate']['statement']['accountId'] === $actor && $i['certificate']['statement']['deviceId'] === $old['deviceId'], 422);
            $oldKey = $this->keys->document($actor);
            Protocol::ed('capture-device', $i['certificate']['statement'], $i['certificate']['signature'], $oldKey['record']['authorityKey']);
            Protocol::p256('submission', $old, $i['signature'], $i['certificate']['statement']['signingKey']);
        }
        $kinds = ['metadata', 'original', 'preview', 'restricted-metadata', 'thumbnail'];
        abort_unless(array_keys($packets) === $kinds && array_keys($s['packetHashes']) === $kinds, 422);
        $existing = DB::table('encrypted_photos')->find($s['id']);
        if ($existing && $existing->creator_id === $actor && $existing->state === 'active' && $existing->expires_at > Retention::milliseconds() && $existing->submission === $data['submission'] && $existing->submission_signature === $data['signature']) {
            $this->workspace->grant($actor, $existing);

            return response()->json(['received' => true, 'id' => $s['id'], 'expiresAt' => (int) $existing->expires_at]);
        }
        $this->notDeleted($actor, $s);
        $plan = $packets['original']['plan'] ?? [];
        $current = $this->keys->plan($actor, $s['assignmentId'], $plan);
        abort_unless($current['vaultId'] === $s['vaultId'] && $current['epoch'] === $s['epoch'] && $s['planHash'] === Protocol::digest($plan) && $current['retentionSeconds'] && $s['retentionSeconds'] <= $current['retentionSeconds'], 409);
        $anchor = DB::table('workspace_clock_anchors')->where('id', $s['anchor'])->where('account_id', $actor)->value('issued_at');
        abort_unless($anchor && $s['expiresAt'] <= (int) $anchor + $s['retentionSeconds'] * 1000, 422);
        abort_if($s['expiresAt'] <= Retention::milliseconds(), 410);
        $total = 0;
        $files = [];
        foreach ($kinds as $kind) {
            $statement = $this->objects->packet($request, $packets[$kind], $current, $s['id'], $actor, $kind, 1);
            abort_unless(isset($s['initial']) === isset($packets[$kind]['initial']), 422);
            abort_unless($s['packetHashes'][$kind] === Protocol::digest($packets[$kind]), 422);
            $file = $request->file('files.'.$kind);
            abort_unless($file && $file->getSize() === (int) $statement['ciphertextBytes'] && Protocol::ciphertextHash($file->getRealPath()) === $statement['ciphertextHash'], 422);
            Protocol::framing($file->getRealPath(), $statement['descriptor']);
            $files[$kind] = $file;
            $total += $file->getSize();
        }
        Protocol::p256('submission', $s, $data['signature'], $packets['original']['certificate']['statement']['signingKey']);
        DB::transaction(function () use ($actor, $s, $plan, $data, $packets, $files, $total) {
            $vault = $this->workspace->capture($actor, $s['assignmentId'], isset($s['migration']));
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            $this->notDeleted($actor, $s);
            $this->keys->plan($actor, $s['assignmentId'], $plan);
            $row = DB::table('encrypted_photos')->find($s['id']);
            if ($row) {
                abort_unless($row->creator_id === $actor && $row->vault_id === $vault->id, 404);
                abort_if($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds(), 410);
                if ($row->submission !== $data['submission'] || $row->submission_signature !== $data['signature']) {
                    abort_unless($row->state === 'pending' && isset($s['initial']), 409);
                    $prior = Protocol::decode($row->submission);
                    $base = $prior['initial'] ?? ['statement' => $prior, 'signature' => $row->submission_signature, 'certificate' => $packets['original']['initial']['certificate']];
                    abort_unless(Protocol::canonical($base) === Protocol::canonical($s['initial']), 409);
                    foreach ($packets as $kind => $packet) {
                        $old = DB::table('encrypted_objects')->where('photo_id', $row->id)->where('kind', $kind)->first();
                        $proof = Protocol::decode($old->packet);
                        abort_unless($proof['statement']['descriptor'] === $packet['statement']['descriptor'] && $proof['statement']['ciphertextHash'] === $packet['statement']['ciphertextHash'], 409);
                        DB::table('encrypted_objects')->where('id', $old->id)->update(['packet' => Protocol::canonical($packet)]);
                    }
                    DB::table('encrypted_photos')->where('id', $row->id)->update(['submission' => $data['submission'], 'submission_signature' => $data['signature'], 'submission_hash' => Protocol::digest($data['submission'])]);
                }
                if ($row->state === 'active') {
                    return;
                }
            } else {
                $vaults = DB::table('workspace_vaults')->where('owner_id', $vault->owner_id)->pluck('id');
                $legacy = DB::table('workspace_photos')->whereIn('vault_id', $vaults)->whereIn('state', ['active', 'pending']);
                $encrypted = DB::table('encrypted_photos')->whereIn('vault_id', $vaults)->whereIn('state', ['active', 'pending']);
                $encryptedBytes = DB::table('encrypted_objects')->whereIn('photo_id', $encrypted->clone()->select('id'))->sum('bytes');
                abort_if($legacy->clone()->count() + $encrypted->clone()->count() >= config('prototype.max_photos') || $legacy->sum(DB::raw('bytes + thumbnail_bytes + preview_bytes')) + $encryptedBytes + $total > config('prototype.max_bytes'), 413);
                DB::table('encrypted_photos')->insert(['id' => $s['id'], 'vault_id' => $vault->id, 'creator_id' => $actor, 'assignment_id' => $s['assignmentId'], 'submission' => $data['submission'], 'submission_signature' => $data['signature'], 'submission_hash' => Protocol::digest($data['submission']), 'expires_at' => $s['expiresAt'], 'created_at' => now(), 'updated_at' => now()]);
                foreach ($packets as $kind => $packet) {
                    $d = $packet['statement']['descriptor'];
                    DB::table('encrypted_objects')->insert(['id' => $d['object_id'], 'photo_id' => $s['id'], 'kind' => $kind, 'revision' => 1, 'bytes' => $files[$kind]->getSize(), 'object_key' => 'encrypted/'.$vault->id.'/'.$s['id'].'/'.$d['object_id'], 'packet' => Protocol::canonical($packet), 'created_at' => now()]);
                }
            }
        });
        DB::transaction(function () use ($actor, $s, $plan, $files) {
            $vault = $this->workspace->capture($actor, $s['assignmentId'], isset($s['migration']));
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            $this->notDeleted($actor, $s);
            $this->keys->plan($actor, $s['assignmentId'], $plan);
            $row = DB::table('encrypted_photos')->find($s['id']);
            abort_unless($row && $row->submission === Protocol::canonical($s), 409);
            abort_if($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds(), 410);
            if ($row->state === 'active') {
                return;
            }
            $disk = Storage::disk(config('prototype.disk'));
            try {
                foreach (DB::table('encrypted_objects')->where('photo_id', $s['id'])->get() as $object) {
                    $stream = fopen($files[$object->kind]->getRealPath(), 'rb');
                    try {
                        abort_unless($disk->put($object->object_key, $stream) && $disk->size($object->object_key) === (int) $object->bytes, 503);
                    } finally {
                        fclose($stream);
                    }
                }
            } catch (\Throwable) {
                abort(503);
            }
            abort_if($s['expiresAt'] <= Retention::milliseconds(), 410);
            DB::table('encrypted_photos')->where('id', $s['id'])->update(['state' => 'active']);
        });

        return response()->json(['received' => true, 'id' => $s['id'], 'expiresAt' => $s['expiresAt']]);
    }

    public function receipt(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $row = DB::table('encrypted_photos')->where('id', $id)->where('creator_id', $actor)->first();
        abort_unless($row, 404);
        $this->workspace->grant($actor, $row);
        abort_if($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds(), 410);

        return response()->json(['id' => $id, 'state' => $row->state, 'revision' => (int) $row->revision, 'submissionHash' => $row->submission_hash, 'expiresAt' => (int) $row->expires_at]);
    }

    public function index(Request $request)
    {
        $actor = $this->actor($request);
        $this->keys->read($request);
        $vaults = DB::table('workspace_vaults')->where('owner_id', $actor)->orWhereIn('assignment_id', DB::table('workspace_members')->where('account_id', $actor)->where('state', 'accepted')->select('record_id'))->pluck('id');
        $photos = [];
        $receipts = [];
        $deleted = [];
        foreach (DB::table('encrypted_photos')->whereIn('vault_id', $vaults)->get() as $row) {
            try {
                $grant = $this->workspace->grant($actor, $row);
            } catch (HttpException) {
                continue;
            }if ($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds()) {
                $deleted[] = $row->id;

                continue;
            }if ($row->state !== 'active') {
                continue;
            }if ($grant['thumbnail']) {
                $photos[] = $this->objects->serialize($actor, $row);
            } elseif ($row->creator_id === $actor) {
                $receipts[] = $this->objects->serialize($actor, $row);
            }
        }

        return response()->json(['photos' => $photos, 'receipts' => $receipts, 'deleted' => $deleted, 'serverTime' => Retention::milliseconds()]);
    }

    public function show(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $this->keys->read($request);

        return response()->json($this->objects->serialize($actor, $this->objects->active($actor, $id)));
    }

    public function content(Request $request, string $id, string $objectId)
    {
        $actor = $this->actor($request);
        $this->keys->read($request);
        $row = $this->objects->active($actor, $id);
        $object = DB::table('encrypted_objects')->where('photo_id', $id)->where('id', $objectId)->first();
        abort_unless($object && $this->objects->allowed($actor, $row, $object->kind), 404);
        try {
            $stream = Storage::disk(config('prototype.disk'))->readStream($object->object_key);
        } catch (\Throwable) {
            abort(503);
        }abort_unless(is_resource($stream), 503);

        return response()->stream(function () use ($stream) {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, ['Content-Type' => 'application/octet-stream', 'Content-Length' => (string) $object->bytes, 'Cache-Control' => 'no-store']);
    }

    public function append(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $input = $request->validate(['packet' => 'required|string|max:250000', 'event' => 'required|string|max:10000', 'signature' => 'required|string|max:100', 'file' => 'required|file|max:300']);
        $packet = Protocol::decode($input['packet'], 250000);
        $event = Protocol::decode($input['event'], 10000);
        Validator::make($event, ['version' => 'required|integer|in:1', 'id' => 'required|uuid', 'photoId' => 'required|uuid', 'kind' => 'required|in:metadata,restricted-metadata,gps,review,response', 'parent' => 'required|string|size:43', 'expectedRevision' => 'required|integer|min:1', 'packetHash' => 'required|string|size:43', 'reviewState' => 'sometimes|in:accepted,correction,reshoot,rejected', 'replyTo' => 'sometimes|string|size:43', 'expectedReviewRevision' => 'sometimes|integer|min:1', 'expiresAt' => 'sometimes|integer|min:1|max:9007199254740991'])->validate();
        Protocol::fields($event, ['version', 'id', 'photoId', 'kind', 'parent', 'expectedRevision', 'packetHash'], ['reviewState', 'replyTo', 'expectedReviewRevision', 'expiresAt']);
        $result = DB::transaction(function () use ($request, $actor, $id, $input, $packet, $event) {
            $found = DB::table('encrypted_photos')->find($id);
            abort_unless($found, 404);
            $ownerId = DB::table('workspace_vaults')->where('id', $found->vault_id)->value('owner_id');
            DB::table('identity_accounts')->where('id', $ownerId)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
            $row = $this->objects->active($actor, $id);
            $grant = $this->workspace->grant($actor, $row);
            $kind = $event['kind'];
            if ($kind === 'gps') {
                abort_unless($row->creator_id === $actor && strtotime($row->created_at) + 120 >= time(), 403);
            } else {
                $this->keys->read($request);
                if ($kind === 'response') {
                    abort_unless($row->assignment_id && $row->creator_id === $actor, 403);
                } elseif ($kind === 'review') {
                    abort_unless($row->assignment_id && ($row->creator_id === $actor || in_array($grant['role'], ['owner', 'curator'], true)), 403);
                } else {
                    abort_unless($grant['edit'], 403);
                }
            }
            $existing = DB::table('encrypted_objects')->where('id', $packet['statement']['descriptor']['object_id'] ?? '')->first();
            if ($existing) {
                abort_unless($existing->photo_id === $id && $existing->packet === $input['packet'] && $existing->event === $input['event'] && $existing->event_signature === $input['signature'], 409);

                return (int) Protocol::decode($existing->event)['expectedRevision'] + 1;
            }
            abort_unless($event['photoId'] === $id && $event['parent'] === $row->submission_hash && $event['expectedRevision'] === (int) $row->revision && $event['packetHash'] === Protocol::digest($packet), 409);
            if (in_array($kind, ['review', 'response'], true)) {
                abort_unless(($event['expectedReviewRevision'] ?? 0) === (int) $row->review_revision, 409);
                if ($kind === 'review') {
                    abort_unless(in_array($grant['role'], ['owner', 'curator'], true) && $grant['edit'] && isset($event['reviewState']), 403);
                } else {
                    $previous = DB::table('encrypted_objects')->where('photo_id', $id)->where('kind', 'review')->orderByDesc('revision')->first();
                    abort_unless($previous && ($event['replyTo'] ?? '') === Protocol::digest($previous->packet) && ! isset($event['reviewState']) && $row->creator_id === $actor && in_array($row->review_state, ['correction', 'reshoot'], true), 403);
                }
            } elseif (isset($event['reviewState']) || isset($event['replyTo']) || isset($event['expectedReviewRevision'])) {
                abort(422);
            }
            if (isset($event['expiresAt'])) {
                abort_unless($kind === 'metadata' && $event['expiresAt'] <= $row->expires_at, 422);
            }
            $plan = $this->keys->plan($actor, $row->assignment_id, $packet['plan'] ?? []);
            $revision = (int) DB::table('encrypted_objects')->where('photo_id', $id)->where('kind', $kind)->max('revision') + 1;
            $s = $this->objects->packet($request, $packet, $plan, $id, $row->creator_id, $kind, $revision, $row->submission_hash);
            $file = $request->file('file');
            abort_unless($file->getSize() === (int) $s['ciphertextBytes'] && Protocol::ciphertextHash($file->getRealPath()) === $s['ciphertextHash'], 422);
            Protocol::framing($file->getRealPath(), $s['descriptor']);
            Protocol::p256('photo-event', $event, $input['signature'], $packet['certificate']['statement']['signingKey']);
            $vault = DB::table('workspace_vaults')->find($row->vault_id);
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            $bytes = DB::table('encrypted_objects')->whereIn('photo_id', DB::table('encrypted_photos')->whereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $vault->owner_id)->select('id'))->whereIn('state', ['active', 'pending'])->select('id'))->sum('bytes');
            $legacyBytes = DB::table('workspace_photos')->whereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $vault->owner_id)->select('id'))->whereIn('state', ['active', 'pending'])->sum(DB::raw('bytes + thumbnail_bytes + preview_bytes'));
            abort_if($bytes + $legacyBytes + $file->getSize() > config('prototype.max_bytes'), 413);
            $key = 'encrypted/'.$row->vault_id.'/'.$id.'/'.$s['descriptor']['object_id'];
            $disk = Storage::disk(config('prototype.disk'));
            $stream = fopen($file->getRealPath(), 'rb');
            try {
                abort_unless($disk->put($key, $stream) && $disk->size($key) === $file->getSize(), 503);
            } catch (\Throwable) {
                abort(503);
            } finally {
                fclose($stream);
            }
            DB::table('encrypted_objects')->insert(['id' => $s['descriptor']['object_id'], 'photo_id' => $id, 'kind' => $kind, 'revision' => $revision, 'bytes' => $file->getSize(), 'object_key' => $key, 'packet' => $input['packet'], 'event' => $input['event'], 'event_signature' => $input['signature'], 'created_at' => now()]);
            $changes = ['revision' => $row->revision + 1, 'updated_at' => now()];
            if (isset($event['expiresAt'])) {
                $changes['expires_at'] = $event['expiresAt'];
            }
            if ($kind === 'response') {
                $changes['review_revision'] = $row->review_revision + 1;
            }
            if ($kind === 'review') {
                $changes += ['review_state' => $event['reviewState'], 'review_revision' => $row->review_revision + 1];
            }DB::table('encrypted_photos')->where('id', $id)->update($changes);

            return (int) $row->revision + 1;
        });

        return response()->json(['revision' => $result]);
    }

    public function cancelPending(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $this->keys->read($request);
        $data = $request->validate(['vaultId' => 'required|uuid', 'assignmentId' => 'present|nullable|uuid', 'expiresAt' => 'required|integer|min:1|max:9007199254740991']);
        $vault = DB::table('workspace_vaults')->where('id', $data['vaultId'])->first();
        abort_unless($vault && $vault->assignment_id === $data['assignmentId'] && ($data['assignmentId'] !== null || $vault->owner_id === $actor), 404);
        $row = DB::transaction(function () use ($actor, $id, $data, $vault) {
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            if ($data['assignmentId']) {
                DB::table('workspace_records')->where('id', $data['assignmentId'])->lockForUpdate()->first();
            }
            $row = DB::table('encrypted_photos')->where('id', $id)->lockForUpdate()->first();
            abort_if($row && ($row->creator_id !== $actor || $row->vault_id !== $vault->id), 404);
            $target = $row ?? (object) ['vault_id' => $vault->id, 'creator_id' => $actor, 'assignment_id' => $data['assignmentId']];
            abort_unless($this->workspace->grant($actor, $target)['delete'], 403);
            $known = DB::table('encrypted_deletions')->where('account_id', $actor)->where('vault_id', $vault->id)->where('photo_id', $id)->exists();
            abort_if(! $row && ! $known && DB::table('encrypted_deletions')->where('account_id', $actor)->count() >= 2000, 413);
            DB::table('encrypted_deletions')->updateOrInsert(['account_id' => $actor, 'vault_id' => $vault->id, 'photo_id' => $id], ['expires_at' => Retention::milliseconds() + 1209600000]);
            if ($row) {
                DB::table('encrypted_photos')->where('id', $id)->update(['state' => 'deleted']);
            }

            return $row;
        });
        $ok = ! $row || $this->objects->cleanup($row);

        return response()->json(['deletion' => $ok ? 'verified' : 'pending'], $ok ? 200 : 202);
    }

    private function notDeleted(string $actor, array $submission): void
    {
        abort_if(DB::table('encrypted_deletions')->where('account_id', $actor)->where('vault_id', $submission['vaultId'])->where('photo_id', $submission['id'])->exists(), 410);
    }

    public function remove(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $this->keys->read($request);
        $row = DB::transaction(function () use ($actor, $id) {
            $found = DB::table('encrypted_photos')->find($id);
            abort_unless($found, 404);
            $vault = DB::table('workspace_vaults')->find($found->vault_id);
            abort_unless($vault, 404);
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            if ($found->assignment_id) {
                DB::table('workspace_records')->where('id', $found->assignment_id)->lockForUpdate()->first();
            }
            $row = DB::table('encrypted_photos')->where('id', $id)->lockForUpdate()->firstOrFail();
            abort_unless($this->workspace->grant($actor, $row)['delete'], 403);
            DB::table('encrypted_photos')->where('id', $id)->update(['state' => 'deleted']);

            return $row;
        });
        $verified = $this->objects->cleanup($row);

        return response()->json(['deletion' => $verified ? 'verified' : 'pending'], $verified ? 200 : 202);
    }
}
