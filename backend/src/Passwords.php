<?php
declare(strict_types=1);

/** Mots de passe temporaires et règles de robustesse (même règle que le frontend : 8 caractères, lettres et chiffres). */
class Passwords
{
    /** Mot de passe aléatoire lisible (sans caractères ambigus 0/O, 1/l/I), 11 caractères, avec lettres et chiffres. */
    public static function temporary(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        $max = strlen($alphabet) - 1;
        $pass = '';
        for ($i = 0; $i < 10; $i++) {
            $pass .= $alphabet[random_int(0, $max)];
        }
        return $pass . '7';
    }

    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT);
    }

    public static function isStrong(string $plain): bool
    {
        return mb_strlen($plain) >= 8 && preg_match('/[a-zA-Z]/', $plain) === 1 && preg_match('/[0-9]/', $plain) === 1;
    }
}
