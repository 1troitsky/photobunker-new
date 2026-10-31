<?php

namespace App\Prototype;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class ProfileRules
{
    public static function validate(array $input): array
    {
        $rules = Validator::make($input, [
            'curatorDescriptionEditable' => 'sometimes|boolean',
            'retentionSeconds' => 'sometimes|integer|min:3600|max:1209600',
            'resolution' => ['required', Rule::in(['maximum', 'fixed'])],
            'width' => 'required|integer|min:64|max:16384', 'height' => 'required|integer|min:64|max:16384',
            'aspect' => ['required', Rule::in(['native', '1:1', '4:3', '3:2', '16:9', 'custom'])],
            'aspectWidth' => 'required|integer|min:1|max:100', 'aspectHeight' => 'required|integer|min:1|max:100',
            'fit' => ['required', Rule::in(['crop', 'contain'])], 'quality' => 'required|numeric|min:0.6|max:1',
            'metadata' => ['required', Rule::in(['all', 'selected', 'none'])],
            'keepDate' => 'required|boolean', 'keepCamera' => 'required|boolean',
            'location' => ['required', Rule::in(['off', 'optional', 'required'])],
            'accuracy' => 'required|integer|min:1|max:1000', 'locationWindow' => 'required|integer|min:1|max:60',
            'descriptionRequired' => 'required|boolean', 'descriptionEditable' => 'required|boolean',
            'categoryRequired' => 'required|boolean', 'categories' => 'present|array|max:30',
            'categories.*' => 'required|string|max:80|distinct',
            'shotList' => 'present|array|max:30', 'shotList.*' => 'required|string|max:80|distinct',
            'idPrefix' => ['present', 'nullable', 'string', 'max:8', 'regex:/^[A-Z0-9]*$/D'],
        ])->validate();
        $ratio = match ($rules['aspect']) {
            'native' => null, 'custom' => $rules['aspectWidth'] / $rules['aspectHeight'],
            default => (float) explode(':', $rules['aspect'])[0] / (float) explode(':', $rules['aspect'])[1],
        };
        if ($rules['resolution'] === 'fixed' && ($rules['width'] * $rules['height'] > 50000000
            || ($ratio !== null && abs($rules['width'] / $rules['height'] - $ratio) > 0.001))) {
            throw ValidationException::withMessages(['rules.width' => 'profile.invalid_dimensions']);
        }
        if (($rules['metadata'] === 'none' && ($rules['keepDate'] || $rules['keepCamera'] || $rules['location'] !== 'off'))
            || ($rules['metadata'] === 'all' && (! $rules['keepDate'] || ! $rules['keepCamera'] || $rules['location'] === 'off'))
            || ($rules['categoryRequired'] && count($rules['categories']) === 0)) {
            throw ValidationException::withMessages(['rules.metadata' => 'profile.conflicting_rules']);
        }
        $rules['idPrefix'] = $rules['idPrefix'] ?? '';

        return $rules;
    }
}
