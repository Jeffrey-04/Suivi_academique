<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Passwords.php';
require_once __DIR__ . '/../Mailer.php';

class AccountController
{
    private static function resolveSettings(?array $userSettings, array $config): array
    {
        return [
            'announcements'    => true,
            'reminders'        => $config['reminder_days'] ?? [7, 1],
            'calendarView'     => 'auto',
            'sidebarCollapsed' => false,
            ...($userSettings ?? [])
        ];
    }

    public function profile(): void
    {
        $user = Auth::requireLogin();
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $person = null;
        $className = null;

        if ($user['role'] === 'etudiant' && $user['profileId']) {
            $stmt = $db->prepare('
                SELECT s.id, s.matricule, s.first_name AS firstName, s.last_name AS lastName, s.birth_date AS birthDate,
                       s.birth_place AS birthPlace, s.email, s.phone, s.filiere_id AS filiereId, s.level_id AS levelId, s.photo,
                       l.name AS lvl_name, f.name AS fil_name
                FROM students s
                JOIN levels l ON l.id = s.level_id
                JOIN filieres f ON f.id = l.filiere_id
                WHERE s.id = ?
            ');
            $stmt->execute([$user['profileId']]);
            $row = $stmt->fetch();
            if ($row) {
                $className = "{$row['lvl_name']} · {$row['fil_name']}";
                $person = [
                    'id'         => $row['id'],
                    'matricule'  => $row['matricule'],
                    'firstName'  => $row['firstName'],
                    'lastName'   => $row['lastName'],
                    'birthDate'  => $row['birthDate'],
                    'birthPlace' => $row['birthPlace'],
                    'email'      => $row['email'],
                    'phone'      => $row['phone'],
                    'filiereId'  => $row['filiereId'],
                    'levelId'    => $row['levelId'],
                    'photo'      => $row['photo'],
                ];
            }
        } elseif ($user['role'] === 'enseignant' && $user['profileId']) {
            $stmt = $db->prepare('
                SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo
                FROM teachers WHERE id = ?
            ');
            $stmt->execute([$user['profileId']]);
            $person = $stmt->fetch() ?: null;
            if ($person) {
                $person['contractHours'] = (int)$person['contractHours'];
            }
        }

        Response::json([
            'user'      => $user,
            'person'    => $person,
            'className' => $className,
            'settings'  => self::resolveSettings($user['settings'], $config),
        ]);
    }

    public function updateContact(array $params, array $body): void
    {
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $errors = [];
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
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

        if ($user['role'] !== 'chef' && $phone !== '' && !preg_match('/^\+?[0-9][0-9 ]{6,18}$/', $phone)) {
            $errors['phone'] = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
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

        $db->beginTransaction();
        try {
            $updUser = $db->prepare('UPDATE users SET email = ? WHERE id = ?');
            $updUser->execute([$email, $user['id']]);

            if ($user['role'] === 'etudiant' && $user['profileId']) {
                $updStu = $db->prepare('UPDATE students SET email = ?, phone = ? WHERE id = ?');
                $updStu->execute([$email, $phone ?: null, $user['profileId']]);
            } elseif ($user['role'] === 'enseignant' && $user['profileId']) {
                $updTea = $db->prepare('UPDATE teachers SET email = ?, phone = ? WHERE id = ?');
                $updTea->execute([$email, $phone ?: null, $user['profileId']]);
            }

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, 'La mise à jour des coordonnées a échoué');
        }

        $user['email'] = $email;
        Response::json($user);
    }

    public function updatePhoto(array $params, array $body): void
    {
        $user = Auth::requireLogin();
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

        $db->beginTransaction();
        try {
            $upd = $db->prepare('UPDATE users SET photo = ? WHERE id = ?');
            $upd->execute([$storedPhoto, $user['id']]);

            if ($user['role'] === 'etudiant' && $user['profileId']) {
                $db->prepare('UPDATE students SET photo = ? WHERE id = ?')->execute([$storedPhoto, $user['profileId']]);
            } elseif ($user['role'] === 'enseignant' && $user['profileId']) {
                $db->prepare('UPDATE teachers SET photo = ? WHERE id = ?')->execute([$storedPhoto, $user['profileId']]);
            }

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, 'La mise à jour de la photo a échoué');
        }

        $user['photo'] = $storedPhoto;
        Response::json($user);
    }

    public function changePassword(array $params, array $body): void
    {
        $user = Auth::requireLogin();
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
        $user = Auth::requireLogin();
        $config = require __DIR__ . '/../../config/config.php';
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
            'announcements'    => isset($body['announcements']) ? (bool)$body['announcements'] : true,
            'reminders'        => array_values(array_map('intval', $reminders)),
            'calendarView'     => $calendarView,
            'sidebarCollapsed' => !empty($body['sidebarCollapsed']),
        ];

        $upd = $db->prepare('UPDATE users SET settings = ? WHERE id = ?');
        $upd->execute([json_encode($newSettings), $user['id']]);

        Response::json($newSettings);
    }

    public function listAccounts(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $stmt = $db->query('
            SELECT u.id, u.email, u.role, u.profile_id AS profileId, u.first_name AS firstName, u.last_name AS lastName,
                   u.photo, u.active, u.must_change_password AS mustChangePassword, u.settings,
                   s.matricule, t.grade
            FROM users u
            LEFT JOIN students s ON s.id = u.profile_id AND u.role = "etudiant"
            LEFT JOIN teachers t ON t.id = u.profile_id AND u.role = "enseignant"
            ORDER BY u.role ASC, u.last_name ASC, u.first_name ASC
        ');
        $rows = $stmt->fetchAll();

        $accounts = [];
        foreach ($rows as $r) {
            $detail = null;
            if ($r['role'] === 'chef') {
                $detail = 'Chef de département';
            } elseif ($r['role'] === 'enseignant') {
                $detail = $r['grade'];
            } elseif ($r['role'] === 'etudiant') {
                $detail = $r['matricule'];
            }

            $settings = !empty($r['settings']) ? (is_string($r['settings']) ? json_decode($r['settings'], true) : $r['settings']) : null;

            $accounts[] = [
                'id'                 => $r['id'],
                'email'              => $r['email'],
                'role'               => $r['role'],
                'profileId'          => $r['profileId'],
                'firstName'          => $r['firstName'] ?? '',
                'lastName'           => $r['lastName'] ?? '',
                'photo'              => $r['photo'] ?? 'assets/images/avatar.png',
                'active'             => (bool)$r['active'],
                'mustChangePassword' => (bool)$r['mustChangePassword'],
                'settings'           => $settings,
                'detail'             => $detail,
            ];
        }

        // Filtres
        if (!empty($query['role'])) {
            $accounts = array_values(array_filter($accounts, fn($a) => $a['role'] === $query['role']));
        }
        if (isset($query['active']) && $query['active'] !== '') {
            $act = filter_var($query['active'], FILTER_VALIDATE_BOOLEAN);
            $accounts = array_values(array_filter($accounts, fn($a) => $a['active'] === $act));
        }
        if (!empty($query['q'])) {
            $needle = mb_strtolower(trim((string)$query['q']), 'UTF-8');
            $accounts = array_values(array_filter($accounts, function ($a) use ($needle) {
                $searchable = mb_strtolower("{$a['firstName']} {$a['lastName']} {$a['email']} {$a['detail']}", 'UTF-8');
                return strpos($searchable, $needle) !== false;
            }));
        }

        Response::json($accounts);
    }

    public function setActive(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        if ($user['id'] === $id) {
            Response::validationError('Vous ne pouvez pas désactiver votre propre compte.');
        }

        $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) {
            Response::validationError('Compte introuvable.');
        }

        $active = !empty($body['active']) ? 1 : 0;
        $upd = $db->prepare('UPDATE users SET active = ? WHERE id = ?');
        $upd->execute([$active, $id]);

        $target['active'] = $active;
        Response::json(Auth::formatPublicUser($target));
    }

    public function resetPassword(array $params): void
    {
        $user = Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        if ($user['id'] === $id) {
            Response::validationError('Pour changer votre mot de passe, passez par votre profil.');
        }

        $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) {
            Response::validationError('Compte introuvable.');
        }

        $tempPass = Passwords::temporary();
        $hash = Passwords::hash($tempPass);

        $upd = $db->prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?');
        $upd->execute([$hash, $id]);

        $target['must_change_password'] = 1;

        // Le mot de passe est aussi envoyé par e-mail quand le service est configuré ; il reste affiché une fois au chef
        $mail = Mailer::sendTemporaryPassword($target['email'], trim(($target['first_name'] ?? '') . ' ' . ($target['last_name'] ?? '')), $tempPass, true);

        Response::json([
            'user'              => Auth::formatPublicUser($target),
            'temporaryPassword' => $tempPass,
            'emailSent'         => $mail['sent'],
        ]);
    }
}

