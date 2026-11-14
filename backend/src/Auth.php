<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Response.php';

class Auth
{
    private static bool $started = false;

    public static function startSession(): void
    {
        if (self::$started || session_status() === PHP_SESSION_ACTIVE) {
            self::$started = true;
            return;
        }

        $config = require __DIR__ . '/../config/config.php';
        $sessionConfig = $config['session'] ?? [];
        $sessionName = $sessionConfig['name'] ?? 'SUIVI_SESSID';
        $lifetime = $sessionConfig['lifetime'] ?? 86400 * 7;

        @ini_set('session.use_strict_mode', '1');
        @ini_set('session.use_only_cookies', '1');
        session_name($sessionName);

        $isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

        session_set_cookie_params([
            'lifetime' => $lifetime,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $isHttps,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);

        session_start();
        self::$started = true;
    }

    public static function login(array $user): void
    {
        self::startSession();
        session_regenerate_id(true);

        $_SESSION['user_id'] = $user['id'];
        $_SESSION['role'] = $user['role'];
        $_SESSION['profile_id'] = $user['profileId'] ?? $user['profile_id'] ?? null;
    }

    public static function logout(): void
    {
        self::startSession();
        $_SESSION = [];

        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params["path"],
                $params["domain"],
                $params["secure"],
                $params["httponly"]
            );
        }

        session_destroy();
    }

    public static function user(): ?array
    {
        self::startSession();
        if (empty($_SESSION['user_id'])) {
            return null;
        }

        $db = Database::getConnection();
        $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$_SESSION['user_id']]);
        $row = $stmt->fetch();

        if (!$row || (int)$row['active'] !== 1) {
            self::logout();
            return null;
        }

        return self::formatPublicUser($row);
    }

    public static function formatPublicUser(array $row): array
    {
        $settings = null;
        if (!empty($row['settings'])) {
            $settings = is_string($row['settings']) ? json_decode($row['settings'], true) : $row['settings'];
        }

        return [
            'id'                 => (string)$row['id'],
            'email'              => (string)$row['email'],
            'role'               => (string)$row['role'],
            'profileId'          => $row['profile_id'] ? (string)$row['profile_id'] : null,
            'firstName'          => (string)($row['first_name'] ?? ''),
            'lastName'           => (string)($row['last_name'] ?? ''),
            'photo'              => (string)($row['photo'] ?? 'assets/images/avatar.png'),
            'active'             => (bool)$row['active'],
            'mustChangePassword' => (bool)$row['must_change_password'],
            'settings'           => $settings,
        ];
    }

    public static function requireLogin(): array
    {
        $user = self::user();
        if (!$user) {
            Response::json(['message' => 'Session expirée. Reconnectez-vous.'], 401);
        }
        return $user;
    }

    public static function requireRole(string ...$roles): array
    {
        $user = self::requireLogin();
        if (!in_array($user['role'], $roles, true)) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }
        return $user;
    }

    public static function actor(): ?array
    {
        $user = self::user();
        if (!$user) return null;
        return [
            'id'        => $user['id'],
            'role'      => $user['role'],
            'profileId' => $user['profileId'],
        ];
    }
}

