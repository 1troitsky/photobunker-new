<?php

namespace App\Http\Controllers;

use App\Identity\Accounts;
use App\Workspace\PhotoNames;
use Illuminate\Http\Request;

final class PhotoNameController extends Controller
{
    public function __construct(private readonly Accounts $accounts, private readonly PhotoNames $names) {}

    public function reserve(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $data = $request->validate([
            'requestKey' => 'required|uuid',
            'assignmentId' => 'present|nullable|uuid',
            'count' => 'sometimes|integer|min:1|max:64',
        ]);
        return response()->json($this->names->reserve($actor,
            $request->attributes->get('identity')->device_id,
            $data['assignmentId'], $data['requestKey'], $data['count'] ?? 32));
    }

    public function claim(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $data = $request->validate([
            'photoId' => 'required|uuid',
            'assignmentId' => 'present|nullable|uuid',
            'leaseId' => 'sometimes|nullable|uuid',
            'number' => 'sometimes|nullable|integer|min:1|max:9999',
        ]);
        $code = $this->names->claim($actor,
            $request->attributes->get('identity')->device_id,
            $data['photoId'], $data['assignmentId'],
            $data['leaseId'] ?? null, $data['number'] ?? null);
        return response()->json(['photoId' => $data['photoId'], 'code' => $code]);
    }
}
