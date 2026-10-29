<?php

namespace App\Http\Controllers;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class MessagingController extends Controller
{
    public function peers(Request $request, Accounts $accounts, MatrixBridge $matrix)
    {
        $account = $accounts->current($request);
        $relations = DB::table('identity_address_book')->where('account_id', $account->id)->get();
        $peers = [];
        foreach ($relations as $relation) {
            $id = $relation->contact_id;
            if ($accounts->blocked($account->id, $id)) {
                continue;
            }
            $person = DB::table('identity_accounts')->find($id);
            if (! $person || AccountLifecycle::unavailable($person)) {
                continue;
            }
            $peers[] = [...$accounts->person($person, $account->id), 'matrixUserId' => $matrix->mxid($id), 'ready' => $person->matrix_state === 'ready'];
        }
        $blocked = DB::table('identity_blocks')->where(fn ($q) => $q->where('account_id', $account->id)->orWhere('blocked_id', $account->id))->get()->map(fn ($row) => $matrix->mxid($row->account_id === $account->id ? $row->blocked_id : $row->account_id))->unique()->values()->all();

        return response()->json(['peers' => $peers, 'blocked' => $blocked]);
    }

    public function resolve(Request $request, string $handle, Accounts $accounts, MatrixBridge $matrix)
    {
        $actor = $accounts->current($request);
        $person = $accounts->byHandle($handle);
        abort_unless($person && $person->id !== $actor->id && ! $accounts->blocked($actor->id, $person->id), 404);

        return response()->json([...$accounts->person($person, $actor->id), 'matrixUserId' => $matrix->mxid($person->id), 'ready' => $person->matrix_state === 'ready']);
    }

    public function prepareConversation(Request $request, Accounts $accounts, MatrixBridge $matrix)
    {
        $actor = $accounts->current($request);
        $data = $request->validate(['peers' => 'required|array|min:1|max:30', 'peers.*' => 'required|string|max:255|distinct']);
        $people = [];
        foreach ($data['peers'] as $handle) {
            $person = $accounts->byHandle($handle);
            abort_unless($person && $person->id !== $actor->id, 404);
            $accounts->person($person, $actor->id); // Validate every peer before provisioning any of them.
            $people[$person->id] = $person;
        }
        abort_unless(count($people) === count($data['peers']), 422);
        foreach ($people as $person) {
            try {
                $matrix->provision($person->id);
            } catch (\Throwable) {
                return response()->json(['code' => 'messaging_unavailable'], 503);
            }
        }
        $accounts->current($request);
        $peers = [];
        foreach ($people as $person) {
            $current = DB::table('identity_accounts')->find($person->id);
            abort_unless($current && $current->matrix_state === 'ready', 503);
            $peers[] = [...$accounts->person($current, $actor->id), 'matrixUserId' => $matrix->mxid($current->id), 'ready' => true];
        }

        return response()->json(['peers' => $peers]);
    }

    public function activateConversation(Request $request, Accounts $accounts, MatrixBridge $matrix)
    {
        $actor = $accounts->current($request);
        $data = $request->validate(['roomId' => 'required|string|max:255']);
        $path = '/_matrix/client/v3/rooms/'.rawurlencode($data['roomId']);
        try {
            $state = collect($matrix->workspaceRequest($actor->id, 'GET', $path.'/state'));
            $kind = $state->firstWhere('type', 'org.photobunker.chat')['content']['kind'] ?? null;
            $encryption = $state->firstWhere('type', 'm.room.encryption')['content']['algorithm'] ?? null;
            $members = $state->where('type', 'm.room.member');
            abort_unless(in_array($kind, ['direct', 'group']) && $encryption === 'm.megolm.v1.aes-sha2', 403);
            abort_unless($members->contains(fn ($member) => $member['state_key'] === $matrix->mxid($actor->id) && $member['content']['membership'] === 'join'), 403);
            abort_unless($kind !== 'direct' || $members->count() === 2, 403);
            $active = $members->filter(fn ($member) => in_array($member['content']['membership'], ['join', 'invite']));
            abort_unless($active->count() >= 2 && $active->count() <= 30, 403);
            $people = [];
            foreach ($active as $member) {
                $person = $accounts->byHandle($member['state_key']);
                abort_unless($person && ! AccountLifecycle::unavailable($person), 403);
                $people[$member['state_key']] = $person;
                if ($member['content']['membership'] === 'invite') {
                    abort_unless(($member['sender'] ?? '') === $matrix->mxid($actor->id), 403);
                }
            }
            $ids = array_map(fn ($person) => $person->id, $people);
            abort_if(DB::table('identity_blocks')->whereIn('account_id', $ids)->whereIn('blocked_id', $ids)->exists(), 403);
            // Normalize existing private DMs for future messages; historical visibility is not rewritten.
            if ($kind === 'direct' && ($state->firstWhere('type', 'm.room.history_visibility')['content']['history_visibility'] ?? '') === 'joined') {
                $creator = $accounts->byHandle($state->firstWhere('type', 'm.room.create')['sender'] ?? '');
                abort_unless($creator && in_array($creator->id, $ids), 403);
                $matrix->workspaceRequest($creator->id, 'PUT', $path.'/state/m.room.history_visibility', ['history_visibility' => 'invited']);
            }
            foreach ($active as $member) {
                if ($member['content']['membership'] === 'invite') {
                    $person = $people[$member['state_key']];
                    $fresh = DB::table('identity_accounts')->find($person->id);
                    abort_unless($fresh && ! AccountLifecycle::unavailable($fresh), 403);
                    $matrix->workspaceRequest($person->id, 'POST', '/_matrix/client/v3/join/'.rawurlencode($data['roomId']));
                }
            }
        } catch (HttpException $error) {
            throw $error;
        } catch (\Throwable) {
            return response()->json(['code' => 'messaging_unavailable'], 503);
        }

        return response()->json(['ready' => true]);
    }

    public function prepareDeletion(Request $request, Accounts $accounts, MatrixBridge $matrix)
    {
        $actor = $accounts->current($request);
        $data = $request->validate(['roomId' => 'required|string|max:255']);
        $path = '/_matrix/client/v3/rooms/'.rawurlencode($data['roomId']);
        try {
            $state = $matrix->workspaceRequest($actor->id, 'GET', $path.'/state');
            $chat = collect($state)->firstWhere('type', 'org.photobunker.chat');
            $members = collect($state)->where('type', 'm.room.member');
            abort_unless(($chat['content']['kind'] ?? null) === 'direct' && $members->count() === 2 && $members->contains(fn ($m) => $m['state_key'] === $matrix->mxid($actor->id) && $m['content']['membership'] === 'join'), 403);
            $create = collect($state)->firstWhere('type', 'm.room.create');
            $sender = $create['sender'] ?? '';
            abort_unless(preg_match('/^@pb_([a-f0-9]{32}):'.preg_quote(config('identity.matrix_server'), '/').'$/D', $sender, $match), 403);
            $hex = $match[1];
            $creatorId = substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20);
            $creator = DB::table('identity_accounts')->find($creatorId);
            abort_unless($creator && $members->contains(fn ($m) => $m['state_key'] === $matrix->mxid($creator->id)), 403);
            $powers = $matrix->workspaceRequest($creator->id, 'GET', $path.'/state/m.room.power_levels');
            $matrix->workspaceRequest($creator->id, 'PUT', $path.'/state/m.room.power_levels', [...$powers, 'users' => (object) ($powers['users'] ?? []), 'events' => (object) ($powers['events'] ?? []), 'redact' => 0]);
        } catch (HttpException $error) {
            throw $error;
        } catch (\Throwable) {
            abort(503);
        }

        return response()->json(['ready' => true]);
    }

    public function signing(Request $request, Accounts $accounts, MatrixBridge $matrix)
    {
        $account = $accounts->current($request);
        $mxid = $matrix->mxid($account->id);
        $data = $request->validate(['keys' => 'required|array:master_key,self_signing_key,user_signing_key']);
        foreach (['master_key' => 'master', 'self_signing_key' => 'self_signing', 'user_signing_key' => 'user_signing'] as $field => $usage) {
            $key = $data['keys'][$field] ?? null;
            abort_unless(is_array($key) && ! array_diff(array_keys($key), ['user_id', 'usage', 'keys', 'signatures']) && ($key['user_id'] ?? '') === $mxid && ($key['usage'] ?? []) === [$usage], 422);
            abort_unless(isset($key['keys']) && is_array($key['keys']) && count($key['keys']) === 1, 422);
            foreach ($key['keys'] as $name => $value) {
                abort_unless(is_string($value) && strlen($value) <= 44 && str_starts_with($name, 'ed25519:') && substr($name, 8) === $value && strlen(base64_decode($value, true) ?: '') === 32, 422);
            }
            abort_unless(! isset($key['signatures']) || is_array($key['signatures']) && count($key['signatures']) <= 1, 422);
            foreach ($key['signatures'] ?? [] as $user => $signatures) {
                abort_unless($user === $mxid && is_array($signatures) && count($signatures) <= 5, 422);
                foreach ($signatures as $name => $signature) {
                    abort_unless(is_string($name) && str_starts_with($name, 'ed25519:') && is_string($signature) && strlen($signature) <= 88 && strlen(base64_decode($signature, true) ?: '') === 64, 422);
                }
            }
        }
        try {
            $matrix->uploadSigningKeys($account->id, $request->attributes->get('identity')->device_id, $data['keys']);
        } catch (HttpException $error) {
            throw $error;
        } catch (\Throwable) {
            abort(503);
        }

        return response()->json(new \stdClass);
    }
}
