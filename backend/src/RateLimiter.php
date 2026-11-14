<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';

/**
 * Limitation des tentatives de connexion : au plus MAX_FAILURES échecs par adresse e-mail sur WINDOW secondes
 * (et un plafond plus large par adresse IP). Les échecs sont comptés en base (table login_attempts).
 */
class RateLimiter
{
    public const MAX_FAILURES = 5;
    public const MAX_FAILURES_PER_IP = 30;
    public const WINDOW = 900; // 15 minutes

    private static function ip(): string
    {
        return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'cli'), 0, 45);
    }

    /** Retourne le nombre de secondes à attendre, ou 0 si la connexion est autorisée. */
    public static function retryAfter(PDO $db, string $email): int
    {
        $since = date('Y-m-d H:i:s', time() - self::WINDOW);
        $byEmail = $db->prepare('SELECT COUNT(*), MIN(created_at) FROM login_attempts WHERE email = ? AND created_at >= ?');
        $byEmail->execute([$email, $since]);
        [$count, $first] = $byEmail->fetch(PDO::FETCH_NUM);
        if ((int)$count >= self::MAX_FAILURES) {
            return max(1, self::WINDOW - (time() - (int)strtotime((string)$first)));
        }
        $byIp = $db->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND created_at >= ?');
        $byIp->execute([self::ip(), $since]);
        if ((int)$byIp->fetchColumn() >= self::MAX_FAILURES_PER_IP) {
            return 60;
        }
        return 0;
    }

    public static function fail(PDO $db, string $email): void
    {
        $db->prepare('INSERT INTO login_attempts (email, ip, created_at) VALUES (?, ?, ?)')
            ->execute([$email, self::ip(), date('Y-m-d H:i:s')]);
        if (random_int(1, 20) === 1) { // ménage occasionnel
            $db->prepare('DELETE FROM login_attempts WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 86400)]);
        }
    }

    public static function clear(PDO $db, string $email): void
    {
        $db->prepare('DELETE FROM login_attempts WHERE email = ?')->execute([$email]);
    }
}
