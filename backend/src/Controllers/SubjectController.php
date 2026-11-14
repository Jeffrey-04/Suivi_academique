<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';

class SubjectController
{
    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    public function listSubjects(array $params, array $body, array $query): void
    {
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $sql = 'SELECT id, code, name, coefficient, planned_hours AS plannedHours, level_id AS levelId, semester, teacher_id AS teacherId, unit_id AS unitId
                FROM subjects WHERE 1=1';
        $bindings = [];

        // Scoping
        if ($user['role'] === 'enseignant') {
            $sql .= ' AND teacher_id = ?';
            $bindings[] = $user['profileId'];
        } elseif ($user['role'] === 'etudiant') {
            $stuStmt = $db->prepare('SELECT level_id FROM students WHERE id = ?');
            $stuStmt->execute([$user['profileId']]);
            $lvl = $stuStmt->fetchColumn();
            $sql .= ' AND level_id = ?';
            $bindings[] = $lvl;
        }

        if (!empty($query['levelId'])) {
            $sql .= ' AND level_id = ?';
            $bindings[] = $query['levelId'];
        }
        if (!empty($query['teacherId']) && $user['role'] === 'chef') {
            $sql .= ' AND teacher_id = ?';
            $bindings[] = $query['teacherId'];
        }
        if (!empty($query['semester'])) {
            $sql .= ' AND semester = ?';
            $bindings[] = $query['semester'];
        }

        $sql .= ' ORDER BY code ASC';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        foreach ($rows as $idx => $r) {
            $rows[$idx]['coefficient'] = (float)$r['coefficient'];
            $rows[$idx]['plannedHours'] = (int)$r['plannedHours'];
        }

        Response::json($rows);
    }

    public function getSubject(array $params): void
    {
        $user = Auth::requireLogin();
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id, code, name, coefficient, planned_hours AS plannedHours, level_id AS levelId, semester, teacher_id AS teacherId, unit_id AS unitId
                              FROM subjects WHERE id = ?');
        $stmt->execute([$id]);
        $subject = $stmt->fetch();

        if (!$subject) {
            Response::json(['message' => 'Matière introuvable.'], 404);
        }

        // Scoping
        if ($user['role'] === 'enseignant' && $subject['teacherId'] !== $user['profileId']) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }
        if ($user['role'] === 'etudiant') {
            $stuStmt = $db->prepare('SELECT level_id FROM students WHERE id = ?');
            $stuStmt->execute([$user['profileId']]);
            $lvl = $stuStmt->fetchColumn();
            if ($subject['levelId'] !== $lvl) {
                Response::json(['message' => 'Accès non autorisé.'], 403);
            }
        }

        $subject['coefficient'] = (float)$subject['coefficient'];
        $subject['plannedHours'] = (int)$subject['plannedHours'];
        Response::json($subject);
    }

    public function createSubject(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $errors = [];
        $code = strtoupper(trim((string)($body['code'] ?? '')));
        $name = trim((string)($body['name'] ?? ''));
        $levelId = (string)($body['levelId'] ?? '');
        $semester = (string)($body['semester'] ?? '');
        $coefVal = $body['coefficient'] ?? null;
        $hoursVal = $body['plannedHours'] ?? null;
        $teacherId = trim((string)($body['teacherId'] ?? '')) ?: null;
        $unitId = trim((string)($body['unitId'] ?? '')) ?: null;

        if (!preg_match('/^[A-Z0-9]{2,10}$/', $code)) {
            $errors['code'] = 'Code de 2 à 10 lettres ou chiffres (ex. INF201).';
        } else {
            $chk = $db->prepare('SELECT 1 FROM subjects WHERE code = ?');
            $chk->execute([$code]);
            if ($chk->fetch()) {
                $errors['code'] = 'Ce code est déjà utilisé par une autre matière.';
            }
        }

        if (mb_strlen($name) < 3) {
            $errors['name'] = "L'intitulé est obligatoire (3 caractères minimum).";
        }

        $lvlStmt = $db->prepare('SELECT 1 FROM levels WHERE id = ?');
        $lvlStmt->execute([$levelId]);
        if (!$lvlStmt->fetch()) {
            $errors['levelId'] = 'Choisissez un niveau.';
        }

        if (!in_array($semester, ['S1', 'S2'], true)) {
            $errors['semester'] = 'Choisissez un semestre.';
        }

        $coef = is_numeric($coefVal) ? (float)$coefVal : 0.0;
        if (!is_numeric($coefVal) || $coef <= 0 || $coef > 10 || abs($coef * 10 - round($coef * 10)) > 1e-6) {
            $errors['coefficient'] = 'Coefficient entre 0,1 et 10 (une décimale au maximum).';
        }

        $hours = is_numeric($hoursVal) ? (int)$hoursVal : 0;
        if (!is_numeric($hoursVal) || $hours < 1 || $hours > 200 || (string)$hours !== (string)(int)$hoursVal) {
            $errors['plannedHours'] = "Nombre entier d'heures entre 1 et 200.";
        }

        if ($teacherId !== null) {
            $teaStmt = $db->prepare('SELECT 1 FROM teachers WHERE id = ?');
            $teaStmt->execute([$teacherId]);
            if (!$teaStmt->fetch()) {
                $errors['teacherId'] = 'Enseignant inconnu.';
            }
        }

        if ($unitId !== null) {
            $uStmt = $db->prepare('SELECT level_id, semester FROM units WHERE id = ?');
            $uStmt->execute([$unitId]);
            $unit = $uStmt->fetch();
            if (!$unit) {
                $errors['unitId'] = 'Unité d\'enseignement inconnue.';
            } elseif ($unit['level_id'] !== $levelId || $unit['semester'] !== $semester) {
                $errors['unitId'] = 'Cette unité n\'appartient pas à la classe ou au semestre choisis.';
            }
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $id = self::generateId('sub', $db, 'subjects');
        $stmt = $db->prepare('
            INSERT INTO subjects (id, code, name, coefficient, planned_hours, level_id, semester, teacher_id, unit_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $id, $code, $name, $coef, $hours, $levelId, $semester, $teacherId, $unitId
        ]);

        Response::json([
            'id'           => $id,
            'code'         => $code,
            'name'         => $name,
            'coefficient'  => $coef,
            'plannedHours' => $hours,
            'levelId'      => $levelId,
            'semester'     => $semester,
            'teacherId'    => $teacherId,
            'unitId'       => $unitId,
        ], 201);
    }

    public function updateSubject(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT * FROM subjects WHERE id = ?');
        $stmt->execute([$id]);
        $subject = $stmt->fetch();
        if (!$subject) {
            Response::json(['message' => 'Matière introuvable.'], 404);
        }

        $errors = [];
        $code = strtoupper(trim((string)($body['code'] ?? '')));
        $name = trim((string)($body['name'] ?? ''));
        $levelId = (string)($body['levelId'] ?? '');
        $semester = (string)($body['semester'] ?? '');
        $coefVal = $body['coefficient'] ?? null;
        $hoursVal = $body['plannedHours'] ?? null;
        $teacherId = trim((string)($body['teacherId'] ?? '')) ?: null;
        $unitId = trim((string)($body['unitId'] ?? '')) ?: null;

        if (!preg_match('/^[A-Z0-9]{2,10}$/', $code)) {
            $errors['code'] = 'Code de 2 à 10 lettres ou chiffres (ex. INF201).';
        } else {
            $chk = $db->prepare('SELECT 1 FROM subjects WHERE code = ? AND id != ?');
            $chk->execute([$code, $id]);
            if ($chk->fetch()) {
                $errors['code'] = 'Ce code est déjà utilisé par une autre matière.';
            }
        }

        if (mb_strlen($name) < 3) {
            $errors['name'] = "L'intitulé est obligatoire (3 caractères minimum).";
        }

        $lvlStmt = $db->prepare('SELECT 1 FROM levels WHERE id = ?');
        $lvlStmt->execute([$levelId]);
        if (!$lvlStmt->fetch()) {
            $errors['levelId'] = 'Choisissez un niveau.';
        }

        if (!in_array($semester, ['S1', 'S2'], true)) {
            $errors['semester'] = 'Choisissez un semestre.';
        }

        // Vérification de blocage si des notes ou des séances existent
        $grdCount = (int)Database::scalar('SELECT COUNT(*) FROM grades WHERE subject_id = ?', [$id]);
        $sesCount = (int)Database::scalar('SELECT COUNT(*) FROM sessions WHERE subject_id = ?', [$id]);
        if ($grdCount > 0 || $sesCount > 0) {
            if ($levelId !== $subject['level_id']) {
                $errors['levelId'] = 'Classe non modifiable : des notes ou des séances sont déjà enregistrées.';
            }
            if ($semester !== $subject['semester']) {
                $errors['semester'] = 'Semestre non modifiable : des notes ou des séances sont déjà enregistrées.';
            }
        }

        $coef = is_numeric($coefVal) ? (float)$coefVal : 0.0;
        if (!is_numeric($coefVal) || $coef <= 0 || $coef > 10 || abs($coef * 10 - round($coef * 10)) > 1e-6) {
            $errors['coefficient'] = 'Coefficient entre 0,1 et 10 (une décimale au maximum).';
        }

        $hours = is_numeric($hoursVal) ? (int)$hoursVal : 0;
        if (!is_numeric($hoursVal) || $hours < 1 || $hours > 200 || (string)$hours !== (string)(int)$hoursVal) {
            $errors['plannedHours'] = "Nombre entier d'heures entre 1 et 200.";
        }

        if ($teacherId !== null) {
            $teaStmt = $db->prepare('SELECT 1 FROM teachers WHERE id = ?');
            $teaStmt->execute([$teacherId]);
            if (!$teaStmt->fetch()) {
                $errors['teacherId'] = 'Enseignant inconnu.';
            }
        }

        if ($unitId !== null) {
            $uStmt = $db->prepare('SELECT level_id, semester FROM units WHERE id = ?');
            $uStmt->execute([$unitId]);
            $unit = $uStmt->fetch();
            if (!$unit) {
                $errors['unitId'] = 'Unité d\'enseignement inconnue.';
            } elseif ($unit['level_id'] !== $levelId || $unit['semester'] !== $semester) {
                $errors['unitId'] = 'Cette unité n\'appartient pas à la classe ou au semestre choisis.';
            }
        }

        if (!empty($errors)) {
            Response::validationError('Veuillez corriger les champs signalés.', $errors);
        }

        $stmt = $db->prepare('
            UPDATE subjects
            SET code = ?, name = ?, coefficient = ?, planned_hours = ?, level_id = ?, semester = ?, teacher_id = ?, unit_id = ?
            WHERE id = ?
        ');
        $stmt->execute([
            $code, $name, $coef, $hours, $levelId, $semester, $teacherId, $unitId, $id
        ]);

        Response::json([
            'id'           => $id,
            'code'         => $code,
            'name'         => $name,
            'coefficient'  => $coef,
            'plannedHours' => $hours,
            'levelId'      => $levelId,
            'semester'     => $semester,
            'teacherId'    => $teacherId,
            'unitId'       => $unitId,
        ]);
    }

    public function subjectUsage(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $grades = (int)Database::scalar('SELECT COUNT(*) FROM grades WHERE subject_id = ?', [$id]);
        $sessions = (int)Database::scalar('SELECT COUNT(*) FROM sessions WHERE subject_id = ?', [$id]);

        Response::json([
            'grades'   => $grades,
            'sessions' => $sessions,
        ]);
    }

    public function deleteSubject(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id FROM subjects WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            Response::json(['message' => 'Matière introuvable.'], 404);
        }

        $grades = (int)Database::scalar('SELECT COUNT(*) FROM grades WHERE subject_id = ?', [$id]);
        $sessions = (int)Database::scalar('SELECT COUNT(*) FROM sessions WHERE subject_id = ?', [$id]);

        if ($grades > 0 || $sessions > 0) {
            $parts = [];
            if ($grades > 0) {
                $parts[] = $grades . ' note' . ($grades > 1 ? 's' : '');
            }
            if ($sessions > 0) {
                $parts[] = $sessions . ' séance' . ($sessions > 1 ? 's' : '');
            }
            Response::validationError(
                "Suppression impossible : cette matière a " . implode(' et ', $parts) . " enregistrée" . ($grades + $sessions > 1 ? 's' : '') . "."
            );
        }

        $db->beginTransaction();
        try {
            $db->prepare('DELETE FROM checkins WHERE subject_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM subjects WHERE id = ?')->execute([$id]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, 'La suppression de la matière a échoué');
        }

        Response::noContent();
    }
}

