<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../RateLimiter.php';

class AuthController
{
    /** Empreinte factice : permet de comparer un mot de passe même quand l'adresse est inconnue. */
    private const DUMMY_HASH = '$2y$12$Zefwl9E7pKoGx2oNxRGCXugLNvhiqvhTi7cmSKSs3JPk9BHVC7QyK';

    public function login(array $params, array $body): void
    {
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::validationError('E-mail ou mot de passe incorrect.');
        }

        $db = Database::getConnection();

        // Limitation des tentatives : au plus 5 échecs par adresse sur 15 minutes
        $wait = RateLimiter::retryAfter($db, $email);
        if ($wait > 0) {
            header('Retry-After: ' . $wait);
            Response::json(['message' => 'Trop de tentatives de connexion. Réessayez dans ' . max(1, (int)ceil($wait / 60)) . ' minute(s).'], 429);
        }

        $stmt = $db->prepare('SELECT * FROM users WHERE LOWER(email) = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        // Vérification toujours effectuée (même pour une adresse inconnue) : durée de réponse identique
        $hash = $user ? $user['password_hash'] : self::DUMMY_HASH;
        $valid = password_verify($password, $hash) && $user;

        if (!$valid) {
            RateLimiter::fail($db, $email);
            Response::validationError('E-mail ou mot de passe incorrect.');
        }

        if ((int)$user['active'] !== 1) {
            Response::validationError('Ce compte est désactivé. Contactez le chef de département.');
        }

        RateLimiter::clear($db, $email);
        Auth::login($user);
        Response::json(Auth::formatPublicUser($user), 200);
    }

    public function logout(): void
    {
        Auth::logout();
        Response::noContent();
    }

    public function me(): void
    {
        $user = Auth::requireLogin();
        Response::json($user, 200);
    }
}

