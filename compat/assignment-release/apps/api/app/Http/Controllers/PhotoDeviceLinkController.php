<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Prototype\Retention;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class PhotoDeviceLinkController
{
    public function __construct(private readonly Accounts $accounts, private readonly Keys $keys) {}

    public function create(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        abort_unless($this->keys->enabled($actor), 409);
        $input = $request->validate(['publicKey' => 'required|string|size:43']);
        Protocol::bytes($input['publicKey'], 32);
        $statement = ['version' => 1, 'id' => (string) Str::uuid(), 'accountId' => $actor, 'deviceId' => $request->attributes->get('identity')->device_id, 'publicKey' => $input['publicKey'], 'nonce' => Protocol::b64(random_bytes(32)), 'expiresAt' => Retention::milliseconds() + 300000];
        DB::table('photo_device_links')->insert(['id' => $statement['id'], 'account_id' => $actor, 'device_id' => $statement['deviceId'], 'request' => Protocol::canonical($statement), 'expires_at' => now()->addMinutes(5)]);

        return response()->json($statement);
    }

    public function show(Request $request, string $id)
    {
        $row = $this->find($request, $id);
        if ($row->device_id !== $request->attributes->get('identity')->device_id) {
            $this->keys->read($request);
        }

        return response()->json(['request' => Protocol::decode($row->request), 'response' => $row->response ? Protocol::decode($row->response) : null]);
    }

    private function find(Request $request, string $id): object
    {
        $row = DB::table('photo_device_links')->where('id', $id)->where('account_id', $this->accounts->current($request)->id)->first();
        abort_unless($row, 404);
        abort_if($row->consumed_at || strtotime($row->expires_at) <= time(), 410);

        return $row;
    }

    public function approve(Request $request, string $id)
    {
        $this->keys->read($request);
        $input = $request->validate(['response' => 'required|string|max:750000']);
        $response = Protocol::decode($input['response'], 750000);
        $validated = validator($response, ['sealed' => 'required|string|max:740000', 'signature' => 'required|string|size:86'])->validate();
        Protocol::bytes($validated['sealed']);
        DB::transaction(function () use ($request, $id, $input, $validated) {
            DB::table('photo_device_links')->where('id', $id)->lockForUpdate()->first();
            $row = $this->find($request, $id);
            abort_unless($row->device_id !== $request->attributes->get('identity')->device_id && ! $row->response, 409);
            $key = $this->keys->document($row->account_id);
            Protocol::ed('device-link', ['request' => Protocol::decode($row->request), 'sealed' => $validated['sealed']], $validated['signature'], $key['record']['authorityKey']);
            DB::table('photo_device_links')->where('id', $id)->update(['response' => $input['response']]);
        });

        return response()->json(['approved' => true]);
    }

    public function consume(Request $request, string $id)
    {
        $row = $this->find($request, $id);
        abort_unless($row->device_id === $request->attributes->get('identity')->device_id, 403);
        DB::table('photo_device_links')->where('id', $id)->update(['consumed_at' => now(), 'response' => null]);

        return response()->json(['consumed' => true]);
    }
}
