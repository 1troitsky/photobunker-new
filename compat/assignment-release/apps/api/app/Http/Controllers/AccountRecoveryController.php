<?php

namespace App\Http\Controllers;

use App\Encrypted\Protocol;
use App\Identity\Accounts;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

final class AccountRecoveryController
{
    public function show(Request $request, Accounts $accounts)
    {
        $actor = $accounts->current($request);
        $row = DB::table('account_recovery_bundles')->where('account_id', $actor->id)->first();

        return response()->json(['envelope' => $row ? Protocol::decode($row->document, 200000) : null]);
    }

    public function save(Request $request, Accounts $accounts)
    {
        $actor = $accounts->current($request);
        $input = $request->validate(['envelope' => 'required|string|max:200000']);
        $document = Protocol::decode($input['envelope'], 200000);
        Protocol::fields($document, ['statement', 'signature']);
        $statement = $document['statement'];
        Validator::make(['statement' => $statement, 'signature' => $document['signature']], [
            'statement' => 'required|array:version,accountId,revision,rootKey,iv,ciphertext',
            'statement.version' => 'required|integer|in:1',
            'statement.accountId' => 'required|uuid',
            'statement.revision' => 'required|integer|min:1|max:1000000',
            'statement.rootKey' => 'required|string|max:1000',
            'statement.iv' => 'required|string|max:20',
            'statement.ciphertext' => 'required|string|max:180000',
            'signature' => 'required|string|max:100',
        ])->validate();
        abort_unless($statement['accountId'] === $actor->id && $statement['rootKey'] === $actor->public_key, 422);
        Protocol::bytes($statement['iv'], 12);
        $size = strlen(Protocol::bytes($statement['ciphertext']));
        abort_unless($size >= 17 && $size <= 131072, 422);
        Protocol::p256('account-recovery', $statement, $document['signature'], $actor->public_key);
        DB::transaction(function () use ($actor, $statement, $input): void {
            DB::table('identity_accounts')->where('id', $actor->id)->lockForUpdate()->firstOrFail();
            $old = DB::table('account_recovery_bundles')->where('account_id', $actor->id)->first();
            if ($old && hash_equals($old->document, $input['envelope'])) {
                return;
            }
            abort_unless($statement['revision'] === ($old ? $old->revision + 1 : 1), 409);
            DB::table('account_recovery_bundles')->updateOrInsert(['account_id' => $actor->id], [
                'revision' => $statement['revision'], 'document' => $input['envelope'],
                'created_at' => $old->created_at ?? now(), 'updated_at' => now(),
            ]);
        });

        return response()->json(['saved' => true]);
    }
}
