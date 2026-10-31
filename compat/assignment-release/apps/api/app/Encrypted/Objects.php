<?php

namespace App\Encrypted;

use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

final class Objects
{
    public function __construct(private readonly Keys $keys, private readonly Workspace $workspace) {}

    public function packet(Request $request, array $packet, array $plan, string $photo, string $creator, string $kind, int $revision, string $initialHash = ''): array
    {
        Protocol::fields($packet, ['statement', 'signature', 'certificate', 'plan', 'envelopes'], ['initial']);
        Validator::make($packet, ['statement' => 'required|array:version,descriptor,descriptorHash,ciphertextHash,ciphertextBytes,recipientEpoch,wrappingRevision,envelopesHash,planHash,accountId,deviceId,certificateHash,initialHash', 'signature' => 'required|string|max:100', 'certificate' => 'required|array', 'plan' => 'required|array', 'envelopes' => 'present|array|max:101', 'envelopes.*' => 'required|array:accountId,fingerprint,sealed', 'envelopes.*.accountId' => 'required|uuid|distinct', 'envelopes.*.fingerprint' => 'required|string|size:43', 'envelopes.*.sealed' => 'required|string|max:10000'])->validate();
        $s = Validator::make($packet['statement'], ['version' => 'required|integer|in:1', 'descriptor' => 'required|array:format,version,suite,vault_id,asset_id,object_id,kind,object_revision,encryption_epoch,chunk_bytes,plaintext_bytes,frame_count', 'descriptorHash' => 'required|string|size:43', 'ciphertextHash' => 'required|string|size:43', 'ciphertextBytes' => 'required|string|regex:/^[1-9][0-9]{0,8}$/D', 'recipientEpoch' => 'required|integer|min:1', 'wrappingRevision' => 'required|integer|min:1', 'envelopesHash' => 'required|string|size:43', 'planHash' => 'required|string|size:43', 'accountId' => 'required|uuid', 'deviceId' => 'required|uuid', 'certificateHash' => 'required|string|size:43', 'initialHash' => 'present|string|max:43'])->validate();
        $d = Validator::make($s['descriptor'], ['format' => 'required|in:pb-object', 'version' => 'required|integer|in:1', 'suite' => 'required|in:sodium-secretstream-xchacha20poly1305', 'vault_id' => 'required|uuid', 'asset_id' => 'required|uuid', 'object_id' => 'required|uuid', 'kind' => 'required|in:original,preview,thumbnail,metadata,restricted-metadata,gps,review,response,local-version,version-metadata', 'object_revision' => 'required|integer|min:1|max:100000', 'encryption_epoch' => 'required|integer|min:1', 'chunk_bytes' => 'required|integer|in:1048576', 'plaintext_bytes' => ['required', 'string', 'regex:/^(0|[1-9][0-9]{0,8})$/D'], 'frame_count' => 'required|integer|min:1|max:64'])->validate();
        $size = (int) $d['plaintext_bytes'];
        $limit = in_array($kind, ['original', 'preview', 'thumbnail', 'local-version'], true) ? 67108864 : 262144;
        abort_unless($d['vault_id'] === $plan['vaultId'] && $d['asset_id'] === $photo && $d['kind'] === $kind && $d['object_revision'] === $revision && $d['encryption_epoch'] <= $plan['epoch'] && $d['frame_count'] === max(1, (int) ceil($size / 1048576)) && $size <= $limit && (int) $s['ciphertextBytes'] === $size + strlen(Protocol::canonical($d)) + 36 + 21 * $d['frame_count'], 422);
        $identity = $request->attributes->get('identity');
        $cert = $this->keys->certificate($request, $packet['certificate']);
        abort_unless($s['accountId'] === $identity->account_id && $s['deviceId'] === $identity->device_id && $cert['accountId'] === $s['accountId'] && $cert['deviceId'] === $s['deviceId'] && $s['version'] === 1 && ($s['wrappingRevision'] === 1 && $s['initialHash'] === $initialHash || $s['wrappingRevision'] > 1 && $initialHash === '' && isset($packet['initial'])) && $s['recipientEpoch'] === $plan['epoch'], 422);
        abort_unless($s['descriptorHash'] === Protocol::digest($d) && $s['envelopesHash'] === Protocol::digest($packet['envelopes']) && $s['certificateHash'] === Protocol::digest($packet['certificate']) && $s['planHash'] === Protocol::digest($packet['plan']) && Protocol::canonical($packet['plan']['statement']) === Protocol::canonical($plan), 422);
        if (isset($packet['initial'])) {
            $this->initial($packet['initial'], $s, $plan);
        }
        $expected = $this->keys->recipients($plan, $creator, $kind);
        $actual = [];
        foreach ($packet['envelopes'] as $e) {
            $actual[] = ['accountId' => $e['accountId'], 'fingerprint' => $e['fingerprint']];
            abort_unless(strlen(Protocol::bytes($e['sealed'])) >= 100, 422);
        }
        abort_unless($actual === $expected, 422);
        Protocol::bytes($s['ciphertextHash'], 32);
        Protocol::p256('object-manifest', $s, $packet['signature'], $cert['signingKey']);

        return $s;
    }

    private function initial(array $proof, array $current, array $plan): void
    {
        Protocol::fields($proof, ['statement', 'signature', 'certificate', 'plan']);
        $s = $proof['statement'];
        $p = $proof['plan'];
        $cert = $proof['certificate'];
        abort_unless($s['wrappingRevision'] === 1 && $s['initialHash'] === '' && $current['initialHash'] === Protocol::digest($proof) && $current['wrappingRevision'] > 1 && $s['descriptor'] === $current['descriptor'] && $s['descriptorHash'] === $current['descriptorHash'] && $s['ciphertextHash'] === $current['ciphertextHash'] && $s['ciphertextBytes'] === $current['ciphertextBytes'] && $s['accountId'] === $current['accountId'] && $s['recipientEpoch'] <= $current['recipientEpoch'] && $p['statement']['vaultId'] === $plan['vaultId'] && $p['statement']['ownerId'] === $plan['ownerId'] && $p['statement']['assignmentId'] === $plan['assignmentId'] && $s['certificateHash'] === Protocol::digest($cert) && $s['planHash'] === Protocol::digest($p), 422);
        $owner = DB::table('identity_accounts')->find($plan['ownerId']);
        Protocol::key($p['authority'], $owner);
        Protocol::ed('capture-plan', $p['statement'], $p['signature'], $p['authority']['record']['authorityKey']);
        $member = collect($p['statement']['members'])->firstWhere('accountId', $s['accountId']);
        abort_unless($member && in_array($member['role'], ['owner', 'curator', 'contributor'], true), 422);
        Protocol::key($member['key'], DB::table('identity_accounts')->find($s['accountId']));
        abort_unless($cert['statement']['accountId'] === $s['accountId'] && $cert['statement']['deviceId'] === $s['deviceId'] && $cert['statement']['authorityKey'] === $member['key']['record']['authorityKey'], 422);
        Protocol::ed('capture-device', $cert['statement'], $cert['signature'], $member['key']['record']['authorityKey']);
        Protocol::p256('object-manifest', $s, $proof['signature'], $cert['statement']['signingKey']);
    }

    public function active(string $actor, string $id): object
    {
        $row = DB::table('encrypted_photos')->find($id);
        abort_unless($row, 404);
        $this->workspace->grant($actor, $row);
        abort_if($row->state !== 'active' || $row->expires_at <= Retention::milliseconds(), 410);

        return $row;
    }

    public function allowed(string $actor, object $row, string $kind): bool
    {
        $grant = $this->workspace->grant($actor, $row);
        if ($kind === 'share-export') {
            return false;
        }
        if (in_array($kind, ['review', 'response'], true)) {
            return $row->creator_id === $actor || in_array($grant['role'], ['owner', 'curator'], true);
        }

        return in_array($kind, ['thumbnail', 'restricted-metadata'], true) ? $grant['thumbnail'] : $grant['read'];
    }

    public function serialize(string $actor, object $row): array
    {
        $objects = [];
        foreach (DB::table('encrypted_objects')->where('photo_id', $row->id)->orderByDesc('revision')->get() as $object) {
            if (in_array($object->kind, ['local-version', 'version-metadata', 'share-export'], true) || isset($objects[$object->kind]) || ! $this->allowed($actor, $row, $object->kind)) {
                continue;
            }$objects[$object->kind] = ['packet' => Protocol::decode($object->packet), 'event' => $object->event ? Protocol::decode($object->event) : null, 'signature' => $object->event_signature];
        }

        $initial = Protocol::decode(DB::table('encrypted_objects')->where('photo_id', $row->id)->where('kind', 'original')->value('packet'));
        $captureKey = collect($initial['plan']['statement']['members'])->firstWhere('accountId', $row->creator_id)['key'];
        $access = $this->workspace->grant($actor, $row);
        $hasOriginal = collect($initial['envelopes'])->contains(fn ($e) => $e['accountId'] === $actor);
        $access['read'] = $access['read'] && $hasOriginal;
        $access['edit'] = $access['edit'] && $access['read'];
        $access['share'] = $access['share'] && $access['read'];
        $access['shareExternal'] = $access['shareExternal'] && $access['read'];
        $metadataKind = $access['read'] ? 'metadata' : 'restricted-metadata';
        $captureMetadata = null;
        if ($access['thumbnail']) {
            $first = DB::table('encrypted_objects')->where('photo_id', $row->id)->where('kind', $metadataKind)->where('revision', 1)->first();
            if ($first) {
                $captureMetadata = ['packet' => Protocol::decode($first->packet), 'event' => null, 'signature' => null];
            }
        }

        return ['nameId' => app(\App\Workspace\PhotoNames::class)->forPhoto($row->id), 'captureMetadata' => $captureMetadata, 'captureCertificate' => $initial['certificate'], 'captureKey' => $captureKey, 'id' => $row->id, 'vaultId' => $row->vault_id, 'creatorId' => $row->creator_id, 'assignmentId' => $row->assignment_id, 'expiresAt' => (int) $row->expires_at, 'revision' => (int) $row->revision, 'reviewRevision' => (int) $row->review_revision, 'reviewState' => $row->review_state, 'submission' => Protocol::decode($row->submission), 'signature' => $row->submission_signature, 'objects' => $objects, 'access' => $access];
    }

    public function cleanup(object $row): bool
    {
        $disk = Storage::disk(config('prototype.disk'));
        try {
            $prefix = 'encrypted/'.$row->vault_id.'/'.$row->id;
            foreach ($disk->allFiles($prefix) as $path) {
                $disk->delete($path);
                if ($disk->exists($path)) {
                    return false;
                }
            }
        } catch (\Throwable) {
            return false;
        }DB::table('encrypted_photos')->where('id', $row->id)->where('state', 'deleted')->update(['delete_verified_at' => now()]);

        return true;
    }
}
