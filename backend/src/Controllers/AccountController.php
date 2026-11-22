<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Passwords.php';

/**
 * Compte du chef de département (seul utilisateur de l'application) : profil, e-mail, photo, mot de passe, réglages.
 * Les enseignants et les étudiants n'ont pas de compte : ce sont des fiches gérées par le chef.
 */
class AccountController
{
    private static function resolveSettings(?array $userSettings, array $config): array
    {
        return [
            'reminders'        => $config['reminder_days'] ?? [7, 1],
            'calendarView'     => 'auto',
            'sidebarCollapsed' => false,
            ...($userSettings ?? [])
        ];
    }

    public function profile(): void
    {
        $user = Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';

        Response::json([
            'user'     => $user,
            'settings' => self::resolveSettings($user['settings'], $config),
        ]);
    }

    public function updateContact(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();

        $errors = [];
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $currentPassword = (string)($body['currentPassword'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = "L'adresse e-mail n'est pas valide.";
        } else {
            $chk = $db->prepare('SELECT 1 FROM users WHERE LOWER(email) = ? AND id != ?');
            $chk->execute([$email, $user['id']]);
            if ($chk->fetch()) {
                $errors['email'] = 'Cette adresse e-mail est déjà utilisée.';
            }
        }

        // Si l'e-mail change, le mot de passe actuel est requis et vérifié
        if (empty($errors['email']) && $email !== strtolower($user['email'])) {
            $pwStmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
            $pwStmt->execute([$user['id']]);
            $hash = $pwStmt->fetchColumn();

            if ($currentPassword === '' || !password_verify($currentPassword, (string)$hash)) {
                $errors['currentPassword'] = 'Mot de passe actuel requis pour changer l\'adresse e-mail.';
            }
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $upd = $db->prepare('UPDATE users SET email = ? WHERE id = ?');
        $upd->execute([$email, $user['id']]);

        $user['email'] = $email;
        Response::json($user);
    }

    public function updatePhoto(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();

        $photo = $body['photo'] ?? null;
        if ($photo !== null && !is_string($photo)) {
            Response::validationError('Image refusée : formats PNG, JPEG ou WebP, 200 Ko maximum.');
        }

        if (is_string($photo)) {
            if (strlen($photo) > 300000 || !preg_match('#^data:image/(png|jpeg|webp);base64,#', $photo)) {
                Response::validationError('Image refusée : formats PNG, JPEG ou WebP, 200 Ko maximum.');
            }
        }

        $storedPhoto = $photo ?: 'assets/images/avatar.png';

        $upd = $db->prepare('UPDATE users SET photo = ? WHERE id = ?');
        $upd->execute([$storedPhoto, $user['id']]);

        $user['photo'] = $storedPhoto;
        Response::json($user);
    }

    public function changePassword(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();

        $errors = [];
        $currentPassword = (string)($body['currentPassword'] ?? '');
        $newPassword     = (string)($body['newPassword'] ?? '');
        $confirmPassword = (string)($body['confirmPassword'] ?? '');

        $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $hash = (string)$stmt->fetchColumn();

        if (!password_verify($currentPassword, $hash)) {
            $errors['currentPassword'] = 'Mot de passe actuel incorrect.';
        }

        if (!Passwords::isStrong($newPassword)) {
            $errors['newPassword'] = 'Au moins 8 caractères, avec des lettres et des chiffres.';
        } elseif ($newPassword === $currentPassword) {
            $errors['newPassword'] = 'Choisissez un mot de passe différent de l\'actuel.';
        }

        if ($confirmPassword !== $newPassword) {
            $errors['confirmPassword'] = 'La confirmation ne correspond pas.';
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $newHash = Passwords::hash($newPassword);
        $upd = $db->prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?');
        $upd->execute([$newHash, $user['id']]);

        Response::noContent();
    }

    public function updateSettings(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();

        $errors = [];
        $reminders = $body['reminders'] ?? [7, 1];
        if (!is_array($reminders)) {
            $errors['reminders'] = 'Échéance de rappel inconnue.';
        } else {
            foreach ($reminders as $r) {
                if (!in_array((int)$r, [7, 1], true)) {
                    $errors['reminders'] = 'Échéance de rappel inconnue.';
                    break;
                }
            }
        }

        $calendarView = $body['calendarView'] ?? 'auto';
        if (!in_array($calendarView, ['auto', 'month', 'agenda'], true)) {
            $errors['calendarView'] = 'Choisissez un affichage.';
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $newSettings = [
            'reminders'        => array_values(array_map('intval', $reminders)),
            'calendarView'     => $calendarView,
            'sidebarCollapsed' => !empty($body['sidebarCollapsed']),
        ];

        $upd = $db->prepare('UPDATE users SET settings = ? WHERE id = ?');
        $upd->execute([json_encode($newSettings), $user['id']]);

        Response::json($newSettings);
    }
}
