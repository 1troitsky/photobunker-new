<?php

namespace App\Http\Controllers;

use App\Http\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

final class HealthController extends Controller
{
    public function live(): JsonResponse
    {
        return response()->json(['status' => 'ok']);
    }

    public function ready(Request $request): JsonResponse
    {
        try {
            DB::connection()->select('select 1');
        } catch (Throwable) {
            return ApiResponse::error($request, 503);
        }

        return response()->json(['status' => 'ready']);
    }
}
