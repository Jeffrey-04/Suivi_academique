<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';
require_once __DIR__ . '/../Passwords.php';
require_once __DIR__ . '/../Mailer.php';

class PeopleController
{
    /** Minuscules sans accents (recherche). Utilise l'extension intl si présente, sinon une table de correspondance. */
    private static function normalize(string $s): string
    {
        $s = mb_strtolower($s, 'UTF-8');
        if (function_exists('transliterator_create')) {
            $transliterator = transliterator_create('NFD; [:Nonspacing Mark:] Remove; NFC;');
            if ($transliterator) {
                return $transliterator->transliterate($s);
            }
        }
        return strtr($s, [
            'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'î' => 'i', 'ï' => 'i', 'í' => 'i', 'ô' => 'o', 'ö' => 'o', 'ó' => 'o', 'õ' => 'o', 'ù' => 'u', 'û' => 'u',
            'ü' => 'u', 'ú' => 'u', 'ç' => 'c', 'ñ' => 'n', 'ÿ' => 'y', 'œ' => 'oe', 'æ' => 'ae',
        ]);
    }

    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    // ==========================================
    // STUDENTS
    // ==========================================

    public function listStudents(array $params, array $body, array $query): void
    {
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $sql = 'SELECT id, matricule, first_name AS firstName, last_name AS lastName, birth_date AS birthDate,
                       birth_place AS birthPlace, email, phone, filiere_id AS filiereId, level_id AS levelId, photo
                FROM students WHERE 1=1';
        $bindings = [];

        // Scoping
        if ($user['role'] === 'etudiant') {
            $sql .= ' AND id = ?';
            $bindings[] = $user['profileId'];
        } elseif ($user['role'] === 'enseignant') {
            // Un enseignant ne voit que les étudiants de ses classes
            $sql .= ' AND level_id IN (SELECT DISTINCT level_id FROM subjects WHERE teacher_id = ?)';
            $bindings[] = $user['profileId'];
        }

        if (!empty($query['filiereId'])) {
            $sql .= ' AND filiere_id = ?';
            $bindings[] = $query['filiereId'];
        }
        if (!empty($query['levelId'])) {
            $sql .= ' AND level_id = ?';
            $bindings[] = $query['levelId'];
        }

        $sql .= ' ORDER BY last_name ASC, first_name ASC';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        // Filtre de recherche q côté PHP si présent (insensible accents et casse)
        if (!empty($query['q'])) {
            $needle = self::normalize($query['q']);
            $rows = array_values(array_filter($rows, function ($s) use ($needle) {
                $searchable = self::normalize("{$s['firstName']} {$s['lastName']} {$s['matricule']} {$s['email']}");
                return strpos($searchable, $needle) !== false;
            }));
        }

        Response::json($rows);
    }

    public function getStudent(array $params): void
    {
        $user = Auth::requireLogin();
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id, matricule, first_name AS firstName, last_name AS lastName, birth_date AS birthDate,
                                     birth_place AS birthPlace, email, phone, filiere_id AS filiereId, level_id AS levelId, photo
                              FROM students WHERE id = ?');
        $stmt->execute([$id]);
        $student = $stmt->fetch();

        if (!$student) {
            Response::json(['message' => 'Étudiant introuvable.'], 404);
        }

        // Contrôle de périmètre
        if ($user['role'] === 'etudiant' && $user['profileId'] !== $id) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }
        if ($user['role'] === 'enseignant') {
            $subStmt = $db->prepare('SELECT 1 FROM subjects WHERE teacher_id = ? AND level_id = ? LIMIT 1');
            $subStmt->execute([$user['profileId'], $student['levelId']]);
            if (!$subStmt->fetch()) {
                Response::json(['message' => 'Accès non autorisé.'], 403);
            }
        }

        Response::json($student);
    }

    public function countStudents(): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();
        $count = (int)$db->query('SELECT COUNT(*) FROM students')->fetchColumn();
        Response::json(['count' => $count]);
    }

    public function createStudent(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $errors = [];
        $firstName = trim((string)($body['firstName'] ?? ''));
        $lastName = trim((string)($body['lastName'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $birthPlace = trim((string)($body['birthPlace'] ?? ''));
        $birthDate = trim((string)($body['birthDate'] ?? ''));
        $levelId = (string)($body['levelId'] ?? '');

        if (mb_strlen($firstName) < 2) {
            $errors['firstName'] = 'Le prénom est obligatoire (2 caractères minimum).';
        }
        if (mb_strlen($lastName) < 2) {
            $errors['lastName'] = 'Le nom est obligatoire (2 caractères minimum).';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = "L'adresse e-mail n'est pas valide.";
        } else {
            $check = $db->prepare('SELECT 1 FROM users WHERE LOWER(email) = ?');
            $check->execute([$email]);
            if ($check->fetch()) {
                $errors['email'] = 'Cette adresse e-mail est déjà utilisée.';
            }
        }

        if (mb_strlen($birthPlace) > 60) {
            $errors['birthPlace'] = 'Lieu de naissance trop long (60 caractères maximum).';
        }
        if ($phone !== '' && !preg_match('/^\+?[0-9][0-9 ]{6,18}$/', $phone)) {
            $errors['phone'] = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
        }

        $levelStmt = $db->prepare('SELECT l.id, l.name, l.filiere_id, f.code AS f_code FROM levels l JOIN filieres f ON f.id = l.filiere_id WHERE l.id = ?');
        $levelStmt->execute([$levelId]);
        $level = $levelStmt->fetch();
        if (!$level) {
            $errors['levelId'] = 'Choisissez un niveau.';
        }

        // Validation birthDate
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $minAgeDate = date('Y-m-d', strtotime('-15 years', strtotime($todayStr)));

        if ($birthDate === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthDate) || strtotime($birthDate) === false) {
            $errors['birthDate'] = 'La date de naissance est obligatoire.';
        } elseif ($birthDate > $minAgeDate) {
            $errors['birthDate'] = "L'étudiant doit avoir au moins 15 ans.";
        } elseif ($birthDate < '1940-01-01') {
            $errors['birthDate'] = 'Date de naissance invraisemblable.';
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        // Génération du matricule
        // Chiffre du niveau : L1..L3 = 1..3, M1 = 4, M2 = 5
        $lvlName = $level['name'];
        $digit = $lvlName[0] === 'L' ? (int)$lvlName[1] : 3 + (int)$lvlName[1];
        $prefix = substr($config['academic_year'], 2, 2) . $level['f_code'] . $digit;

        $matStmt = $db->prepare('SELECT matricule FROM students WHERE matricule LIKE ?');
        $matStmt->execute([$prefix . '%']);
        $existingMats = $matStmt->fetchAll(PDO::FETCH_COLUMN);
        $lastSeq = 0;
        foreach ($existingMats as $m) {
            $seq = (int)substr($m, strlen($prefix));
            $lastSeq = max($lastSeq, $seq);
        }
        $matricule = sprintf('%s%03d', $prefix, $lastSeq + 1);

        $id = self::generateId('stu', $db, 'students');
        $defaultPhoto = 'assets/images/avatar.png';

        $db->beginTransaction();
        try {
            $stmt = $db->prepare('
                INSERT INTO students (id, matricule, first_name, last_name, birth_date, birth_place, email, phone, filiere_id, level_id, photo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ');
            $stmt->execute([
                $id, $matricule, $firstName, $lastName, $birthDate,
                $birthPlace, $email, $phone,
                $level['filiere_id'], $level['id'], $defaultPhoto
            ]);

            $userId = 'usr-' . $id;
            $tempPassword = Passwords::temporary();
            $passHash = Passwords::hash($tempPassword);
            $uStmt = $db->prepare('
                INSERT INTO users (id, email, password_hash, role, profile_id, first_name, last_name, photo, active, must_change_password)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
            ');
            $uStmt->execute([
                $userId, $email, $passHash, 'etudiant', $id,
                $firstName, $lastName, $defaultPhoto
            ]);

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La création de l'étudiant a échoué");
        }

        $mail = Mailer::sendTemporaryPassword($email, "$firstName $lastName", $tempPassword, false);

        Response::json([
            'id'         => $id,
            'matricule'  => $matricule,
            'firstName'  => $firstName,
            'lastName'   => $lastName,
            'birthDate'  => $birthDate,
            'birthPlace' => $birthPlace,
            'email'      => $email,
            'phone'      => $phone,
            'filiereId'  => $level['filiere_id'],
            'levelId'    => $level['id'],
            'photo'      => $defaultPhoto,
            // Mot de passe temporaire : affiché UNE fois au chef (il peut aussi avoir été envoyé par e-mail)
            'temporaryPassword' => $tempPassword,
            'emailSent'         => $mail['sent'],
        ], 201);
    }

    public function updateStudent(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT * FROM students WHERE id = ?');
        $stmt->execute([$id]);
        $student = $stmt->fetch();
        if (!$student) {
            Response::json(['message' => 'Étudiant introuvable.'], 404);
        }

        $errors = [];
        $firstName = trim((string)($body['firstName'] ?? ''));
        $lastName = trim((string)($body['lastName'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $birthPlace = trim((string)($body['birthPlace'] ?? ''));
        $birthDate = trim((string)($body['birthDate'] ?? ''));
        $levelId = (string)($body['levelId'] ?? '');

        if (mb_strlen($firstName) < 2) {
            $errors['firstName'] = 'Le prénom est obligatoire (2 caractères minimum).';
        }
        if (mb_strlen($lastName) < 2) {
            $errors['lastName'] = 'Le nom est obligatoire (2 caractères minimum).';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = "L'adresse e-mail n'est pas valide.";
        } else {
            $check = $db->prepare('SELECT 1 FROM users WHERE LOWER(email) = ? AND id != ?');
            $check->execute([$email, 'usr-' . $id]);
            if ($check->fetch()) {
                $errors['email'] = 'Cette adresse e-mail est déjà utilisée.';
            }
        }

        if (mb_strlen($birthPlace) > 60) {
            $errors['birthPlace'] = 'Lieu de naissance trop long (60 caractères maximum).';
        }
        if ($phone !== '' && !preg_match('/^\+?[0-9][0-9 ]{6,18}$/', $phone)) {
            $errors['phone'] = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
        }

        $levelStmt = $db->prepare('SELECT l.id, l.filiere_id FROM levels l WHERE l.id = ?');
        $levelStmt->execute([$levelId]);
        $level = $levelStmt->fetch();
        if (!$level) {
            $errors['levelId'] = 'Choisissez un niveau.';
        } elseif ($level['id'] !== $student['level_id']) {
            $grdStmt = $db->prepare('SELECT 1 FROM grades WHERE student_id = ? LIMIT 1');
            $grdStmt->execute([$id]);
            if ($grdStmt->fetch()) {
                $errors['levelId'] = 'Changement de classe impossible : cet étudiant a déjà des notes.';
            }
        }

        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $minAgeDate = date('Y-m-d', strtotime('-15 years', strtotime($todayStr)));

        if ($birthDate === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthDate) || strtotime($birthDate) === false) {
            $errors['birthDate'] = 'La date de naissance est obligatoire.';
        } elseif ($birthDate > $minAgeDate) {
            $errors['birthDate'] = "L'étudiant doit avoir au moins 15 ans.";
        } elseif ($birthDate < '1940-01-01') {
            $errors['birthDate'] = 'Date de naissance invraisemblable.';
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $db->beginTransaction();
        try {
            $upd = $db->prepare('
                UPDATE students
                SET first_name = ?, last_name = ?, birth_date = ?, birth_place = ?,
                    email = ?, phone = ?, filiere_id = ?, level_id = ?
                WHERE id = ?
            ');
            $upd->execute([
                $firstName, $lastName, $birthDate, $birthPlace,
                $email, $phone, $level['filiere_id'], $level['id'], $id
            ]);

            $updUser = $db->prepare('
                UPDATE users
                SET first_name = ?, last_name = ?, email = ?
                WHERE id = ?
            ');
            $updUser->execute([$firstName, $lastName, $email, 'usr-' . $id]);

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La mise à jour de l'étudiant a échoué");
        }

        Response::json([
            'id'         => $id,
            'matricule'  => $student['matricule'],
            'firstName'  => $firstName,
            'lastName'   => $lastName,
            'birthDate'  => $birthDate,
            'birthPlace' => $birthPlace,
            'email'      => $email,
            'phone'      => $phone,
            'filiereId'  => $level['filiere_id'],
            'levelId'    => $level['id'],
            'photo'      => $student['photo'],
        ]);
    }

    public function studentRemovalImpact(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $gradesStmt = $db->prepare('SELECT COUNT(*) FROM grades WHERE student_id = ?');
        $gradesStmt->execute([$id]);
        $grades = (int)$gradesStmt->fetchColumn();
        $bulletinsStmt = $db->prepare('SELECT COUNT(*) FROM bulletins WHERE student_id = ?');
        $bulletinsStmt->execute([$id]);
        $bulletins = (int)$bulletinsStmt->fetchColumn();

        Response::json([
            'grades'    => $grades,
            'bulletins' => $bulletins,
        ]);
    }

    public function deleteStudent(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id FROM students WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            Response::json(['message' => 'Étudiant introuvable.'], 404);
        }

        $userId = 'usr-' . $id;

        $db->beginTransaction();
        try {
            $db->prepare('DELETE FROM notifications WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM bulletins WHERE student_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM grades WHERE student_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM students WHERE id = ?')->execute([$id]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La suppression de l'étudiant a échoué");
        }

        Response::noContent();
    }

    // ==========================================
    // TEACHERS
    // ==========================================

    public function listTeachers(): void
    {
        Auth::requireRole('chef', 'enseignant');
        $db = Database::getConnection();
        $stmt = $db->query('
            SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo
            FROM teachers
            ORDER BY last_name ASC, first_name ASC
        ');
        $rows = $stmt->fetchAll();
        foreach ($rows as $i => $r) {
            $rows[$i]['contractHours'] = (int)$r['contractHours'];
        }
        Response::json($rows);
    }

    public function getTeacher(array $params): void
    {
        $user = Auth::requireRole('chef', 'enseignant');
        $id = $params['id'];
        $db = Database::getConnection();

        if ($user['role'] === 'enseignant' && $user['profileId'] !== $id) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $stmt = $db->prepare('
            SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo
            FROM teachers WHERE id = ?
        ');
        $stmt->execute([$id]);
        $teacher = $stmt->fetch();

        if (!$teacher) {
            Response::json(['message' => 'Enseignant introuvable.'], 404);
        }

        $teacher['contractHours'] = (int)$teacher['contractHours'];
        Response::json($teacher);
    }

    public function createTeacher(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $errors = [];
        $firstName = trim((string)($body['firstName'] ?? ''));
        $lastName = trim((string)($body['lastName'] ?? ''));
        $grade = (string)($body['grade'] ?? '');
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $contractHours = $body['contractHours'] ?? null;

        if (mb_strlen($firstName) < 2) {
            $errors['firstName'] = 'Le prénom est obligatoire (2 caractères minimum).';
        }
        if (mb_strlen($lastName) < 2) {
            $errors['lastName'] = 'Le nom est obligatoire (2 caractères minimum).';
        }
        $validGrades = ['Professeur', 'Maître de conférences', 'Chargé de cours', 'Vacataire'];
        if (!in_array($grade, $validGrades, true)) {
            $errors['grade'] = 'Choisissez un grade.';
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = "L'adresse e-mail n'est pas valide.";
        } else {
            $check = $db->prepare('SELECT 1 FROM users WHERE LOWER(email) = ?');
            $check->execute([$email]);
            if ($check->fetch()) {
                $errors['email'] = 'Cette adresse e-mail est déjà utilisée.';
            }
        }

        if ($phone !== '' && !preg_match('/^\+?[0-9][0-9 ]{6,18}$/', $phone)) {
            $errors['phone'] = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
        }

        if ($contractHours === '' || $contractHours === null || !is_numeric($contractHours) || (int)$contractHours < 0 || (int)$contractHours > 500) {
            $errors['contractHours'] = 'Entrez un nombre entier d\'heures entre 0 et 500.';
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $id = self::generateId('tea', $db, 'teachers');
        $defaultPhoto = 'assets/images/avatar.png';
        $hours = (int)$contractHours;

        $db->beginTransaction();
        try {
            $stmt = $db->prepare('
                INSERT INTO teachers (id, first_name, last_name, grade, email, phone, contract_hours, photo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ');
            $stmt->execute([$id, $firstName, $lastName, $grade, $email, $phone, $hours, $defaultPhoto]);

            $userId = 'usr-' . $id;
            $tempPassword = Passwords::temporary();
            $passHash = Passwords::hash($tempPassword);
            $uStmt = $db->prepare('
                INSERT INTO users (id, email, password_hash, role, profile_id, first_name, last_name, photo, active, must_change_password)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
            ');
            $uStmt->execute([$userId, $email, $passHash, 'enseignant', $id, $firstName, $lastName, $defaultPhoto]);

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La création de l'enseignant a échoué");
        }

        $mail = Mailer::sendTemporaryPassword($email, "$firstName $lastName", $tempPassword, false);

        Response::json([
            'id'            => $id,
            'firstName'     => $firstName,
            'lastName'      => $lastName,
            'grade'         => $grade,
            'email'         => $email,
            'phone'         => $phone,
            'contractHours' => $hours,
            'photo'         => $defaultPhoto,
            'temporaryPassword' => $tempPassword,
            'emailSent'         => $mail['sent'],
        ], 201);
    }

    public function updateTeacher(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT * FROM teachers WHERE id = ?');
        $stmt->execute([$id]);
        $teacher = $stmt->fetch();
        if (!$teacher) {
            Response::json(['message' => 'Enseignant introuvable.'], 404);
        }

        $errors = [];
        $firstName = trim((string)($body['firstName'] ?? ''));
        $lastName = trim((string)($body['lastName'] ?? ''));
        $grade = (string)($body['grade'] ?? '');
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $phone = trim((string)($body['phone'] ?? ''));
        $contractHours = $body['contractHours'] ?? null;

        if (mb_strlen($firstName) < 2) {
            $errors['firstName'] = 'Le prénom est obligatoire (2 caractères minimum).';
        }
        if (mb_strlen($lastName) < 2) {
            $errors['lastName'] = 'Le nom est obligatoire (2 caractères minimum).';
        }
        $validGrades = ['Professeur', 'Maître de conférences', 'Chargé de cours', 'Vacataire'];
        if (!in_array($grade, $validGrades, true)) {
            $errors['grade'] = 'Choisissez un grade.';
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = "L'adresse e-mail n'est pas valide.";
        } else {
            $check = $db->prepare('SELECT 1 FROM users WHERE LOWER(email) = ? AND id != ?');
            $check->execute([$email, 'usr-' . $id]);
            if ($check->fetch()) {
                $errors['email'] = 'Cette adresse e-mail est déjà utilisée.';
            }
        }

        if ($phone !== '' && !preg_match('/^\+?[0-9][0-9 ]{6,18}$/', $phone)) {
            $errors['phone'] = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
        }

        if ($contractHours === '' || $contractHours === null || !is_numeric($contractHours) || (int)$contractHours < 0 || (int)$contractHours > 500) {
            $errors['contractHours'] = 'Entrez un nombre entier d\'heures entre 0 et 500.';
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $hours = (int)$contractHours;

        $db->beginTransaction();
        try {
            $upd = $db->prepare('
                UPDATE teachers
                SET first_name = ?, last_name = ?, grade = ?, email = ?, phone = ?, contract_hours = ?
                WHERE id = ?
            ');
            $upd->execute([$firstName, $lastName, $grade, $email, $phone, $hours, $id]);

            $updUser = $db->prepare('
                UPDATE users
                SET first_name = ?, last_name = ?, email = ?
                WHERE id = ?
            ');
            $updUser->execute([$firstName, $lastName, $email, 'usr-' . $id]);

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La mise à jour de l'enseignant a échoué");
        }

        Response::json([
            'id'            => $id,
            'firstName'     => $firstName,
            'lastName'      => $lastName,
            'grade'         => $grade,
            'email'         => $email,
            'phone'         => $phone,
            'contractHours' => $hours,
            'photo'         => $teacher['photo'],
        ]);
    }

    public function teacherUsage(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $subStmt = $db->prepare('SELECT id, code, name, coefficient, planned_hours AS plannedHours, level_id AS levelId, semester, teacher_id AS teacherId, unit_id AS unitId FROM subjects WHERE teacher_id = ?');
        $subStmt->execute([$id]);
        $subjects = $subStmt->fetchAll();
        foreach ($subjects as $i => $s) {
            $subjects[$i]['coefficient'] = (float)$s['coefficient'];
            $subjects[$i]['plannedHours'] = (int)$s['plannedHours'];
        }

        $sesStmt = $db->prepare('SELECT COUNT(*) FROM sessions WHERE teacher_id = ?');
        $sesStmt->execute([$id]);
        $sessionsCount = (int)$sesStmt->fetchColumn();

        Response::json([
            'subjects' => $subjects,
            'sessions' => $sessionsCount,
        ]);
    }

    public function deleteTeacher(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id FROM teachers WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            Response::json(['message' => 'Enseignant introuvable.'], 404);
        }

        // Vérification usage
        $subStmt = $db->prepare('SELECT COUNT(*) FROM subjects WHERE teacher_id = ?');
        $subStmt->execute([$id]);
        $subCount = (int)$subStmt->fetchColumn();
        $sesStmt = $db->prepare('SELECT COUNT(*) FROM sessions WHERE teacher_id = ?');
        $sesStmt->execute([$id]);
        $sesCount = (int)$sesStmt->fetchColumn();

        if ($subCount > 0 || $sesCount > 0) {
            $parts = [];
            if ($subCount > 0) {
                $parts[] = $subCount . ' matière' . ($subCount > 1 ? 's' : '') . ' attribuée' . ($subCount > 1 ? 's' : '');
            }
            if ($sesCount > 0) {
                $parts[] = $sesCount . ' séance' . ($sesCount > 1 ? 's' : '') . ' enregistrée' . ($sesCount > 1 ? 's' : '');
            }
            Response::validationError(
                "Suppression impossible : cet enseignant a " . implode(' et ', $parts) . ". Réattribuez ses matières d'abord."
            );
        }

        $userId = 'usr-' . $id;

        $db->beginTransaction();
        try {
            $db->prepare('DELETE FROM notifications WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM checkins WHERE teacher_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM teachers WHERE id = ?')->execute([$id]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La suppression de l'enseignant a échoué");
        }

        Response::noContent();
    }
}

