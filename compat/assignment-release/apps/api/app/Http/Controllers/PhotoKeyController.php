<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Identity\Proof;
use App\Prototype\Retention;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class PhotoKeyController
{
    public function __construct(private readonly Accounts $accounts, private readonly Keys $keys) {}

    public function show(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $row = DB::table('photo_keys')->where('account_id', $actor)->first();

        return response()->json($row ? ['enabled' => true, 'document' => Protocol::decode($row->document), 'bundle' => Protocol::decode($row->bundle)] : ['enabled' => false]);
    }

    public function save(Request $request)
    {
        $actor = $this->accounts->current($request);
        $input = $request->validate(['document' => 'required|string|max:20000', 'bundle' => 'required|string|max:100000']);
        $doc = Protocol::decode($input['document'], 20000);
        $bundle = Protocol::decode($input['bundle'], 100000);
        Protocol::key($doc, $actor);
        abort_unless(Protocol::digest($bundle) === $doc['record']['bundleHash'] && $bundle['accountId'] === $actor->id && $bundle['recoveryId'] === $doc['record']['recoveryId'] && $bundle['revision'] === $doc['record']['revision'] && $bundle['fingerprint'] === Protocol::digest(Protocol::bytes($doc['record']['authorityKey'], 32)), 422);
        Protocol::bytes($bundle['nonce'], 24);
        abort_unless(strlen(Protocol::bytes($bundle['ciphertext'])) >= 64, 422);
        DB::transaction(function () use ($actor, $doc, $input, $request): void {
            DB::table('identity_accounts')->where('id', $actor->id)->lockForUpdate()->firstOrFail();
            $old = DB::table('photo_keys')->where('account_id', $actor->id)->first();
            if ($old && $old->document === $input['document'] && $old->bundle === $input['bundle']) {
                return;
            }
            if ($old) {
                $this->keys->read($request);
                $previous = Protocol::decode($old->document);
                abort_unless($doc['record']['revision'] === $old->revision + 1 && $doc['record']['authorityKey'] === $previous['record']['authorityKey'] && $doc['record']['previousHash'] === Protocol::digest($old->document), 409);
            } else {
                abort_unless($doc['record']['revision'] === 1 && $doc['record']['previousHash'] === '', 409);
            }
            DB::table('photo_keys')->updateOrInsert(['account_id' => $actor->id], ['document' => $input['document'], 'bundle' => $input['bundle'], 'revision' => $doc['record']['revision'], 'created_at' => $old->created_at ?? now(), 'updated_at' => now()]);
            DB::table('photo_read_sessions')->where('account_id', $actor->id)->delete();
        });

        return response()->json(['saved' => true]);
    }

    public function device(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $this->keys->read($request);
        $input = $request->validate(['certificate' => 'required|string|max:10000']);
        $doc = Protocol::decode($input['certificate'], 10000);
        $statement = $doc['statement'] ?? [];
        $key = $this->keys->document($actor);
        abort_unless(($statement['version'] ?? null) === 1 && ($statement['accountId'] ?? '') === $actor && ($statement['deviceId'] ?? '') === $request->attributes->get('identity')->device_id && ($statement['authorityKey'] ?? '') === $key['record']['authorityKey'] && ($statement['expiresAt'] ?? 0) > Retention::milliseconds() && $statement['expiresAt'] <= Retention::milliseconds() + 2592000000, 422);
        Proof::publicKey($statement['signingKey']);
        Protocol::ed('capture-device', $statement, $doc['signature'] ?? '', $key['record']['authorityKey']);
        DB::table('photo_devices')->updateOrInsert(['device_id' => $statement['deviceId']], ['account_id' => $actor, 'certificate' => $input['certificate'], 'expires_at' => Carbon::createFromTimestampMs($statement['expiresAt'])]);

        return response()->json(['saved' => true]);
    }

    public function challenge(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $key = $this->keys->document($actor);
        $identity = $request->attributes->get('identity');
        $statement = ['version' => 1, 'purpose' => 'photo-read', 'id' => (string) Str::uuid(), 'nonce' => Protocol::b64(random_bytes(32)), 'accountId' => $actor, 'deviceId' => $identity->device_id, 'origin' => $request->header('Origin'), 'expiresAt' => now()->addMinutes(2)->getTimestampMs(), 'keyRevision' => $key['record']['revision']];
        DB::table('photo_read_challenges')->insert(['id' => $statement['id'], 'account_id' => $actor, 'device_id' => $identity->device_id, 'session_hash' => hash('sha256', $request->cookie('pb_identity', '')), 'statement' => Protocol::canonical($statement), 'key_revision' => $key['record']['revision'], 'expires_at' => now()->addMinutes(2)]);

        return response()->json($statement);
    }

    public function session(Request $request)
    {
        $input = $request->validate(['id' => 'required|uuid', 'signature' => 'required|string|max:100']);
        $identity = $request->attributes->get('identity');
        $result = DB::transaction(function () use ($input, $identity, $request) {
            $row = DB::table('photo_read_challenges')->where('id', $input['id'])->lockForUpdate()->first();
            abort_unless($row && ! $row->consumed_at && strtotime($row->expires_at) > time() && $row->account_id === $identity->account_id && $row->device_id === $identity->device_id && $row->session_hash === hash('sha256', $request->cookie('pb_identity', '')), 401);
            $key = $this->keys->document($identity->account_id);
            abort_unless($row->key_revision === $key['record']['revision'], 409);
            Protocol::ed('read-proof', Protocol::decode($row->statement), $input['signature'], $key['record']['readKey']);
            DB::table('photo_read_challenges')->where('id', $row->id)->update(['consumed_at' => now()]);
            $token = bin2hex(random_bytes(32));
            $expires = now()->addMinutes(5);
            DB::table('photo_read_sessions')->insert(['token_hash' => hash('sha256', $token), 'account_id' => $row->account_id, 'device_id' => $row->device_id, 'session_hash' => $row->session_hash, 'key_revision' => $row->key_revision, 'expires_at' => $expires]);

            return ['token' => $token, 'expiresAt' => $expires->getTimestampMs()];
        });

        return response()->json($result);
    }

    public function revoke(Request $request)
    {
        $identity = $request->attributes->get('identity');
        DB::table('photo_read_sessions')->where('account_id', $identity->account_id)->where('device_id', $identity->device_id)->delete();

        return response()->json(['locked' => true]);
    }

    public function context(Request $request)
    {
        $input = $request->validate(['assignmentId' => 'sometimes|nullable|uuid']);

        return response()->json($this->keys->context($this->accounts->current($request)->id, $input['assignmentId'] ?? null));
    }

    public function plan(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $this->keys->read($request);
        $input = $request->validate(['plan' => 'required|string|max:200000']);
        $doc = Protocol::decode($input['plan'], 200000);
        $context = $this->keys->plan($actor, $doc['statement']['assignmentId'] ?? null, $doc);
        abort_unless($context['ownerId'] === $actor, 403);
        DB::table('workspace_vaults')->where('id', $context['vaultId'])->where('crypto_epoch', $context['epoch'])->update(['capture_plan' => $input['plan']]);

        return response()->json(['saved' => true]);
    }
}
