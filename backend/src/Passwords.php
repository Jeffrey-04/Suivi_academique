<?php
declare(strict_types=1);

/** Hachage et règles de robustesse (même règle que le frontend : 8 caractères, lettres et chiffres). */
class Passwords
{
    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT);
    }

    public static function isStrong(string $plain): bool
    {
        return mb_strlen($plain) >= 8 && preg_match('/[a-zA-Z]/', $plain) === 1 && preg_match('/[0-9]/', $plain) === 1;
    }
}
