<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Throwable;

class TurnstileVerifier
{
    public const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    public function passes(?string $token, ?string $ip): bool
    {
        if (! is_string($token) || $token === '') {
            return false;
        }

        try {
            $response = Http::asForm()->timeout(5)->post(self::VERIFY_URL, array_filter([
                'secret' => config('feedback.public_reporting.turnstile.secret_key'),
                'response' => $token,
                'remoteip' => $ip,
            ]));
        } catch (Throwable) {
            return false;
        }

        return $response->ok() && $response->json('success') === true;
    }
}
