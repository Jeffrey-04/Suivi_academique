<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';
require_once __DIR__ . '/../Calculations.php';

class GradeController
{
    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    public function listGrades(array $params, array $body, array $query): void
    {
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $sql = 'SELECT id, student_id AS studentId, subject_id AS subjectId, type, value, status,
                       entered_by AS enteredBy, entered_at AS enteredAt, validated_by AS validatedBy, validated_at AS validatedAt
                FROM grades WHERE 1=1';
        $bindings = [];

        // Sécurité périmètre
        if ($user['role'] === 'etudiant') {
            $sql .= ' AND student_id = ? AND status = "validee"';
            $bindings[] = $user['profileId'];
        } elseif ($user['role'] === 'enseignant') {
            $sql .= ' AND subject_id IN (SELECT id FROM subjects WHERE teacher_id = ?)';
            $bindings[] = $user['profileId'];
        }

        if (!empty($query['studentId']) && $user['role'] !== 'etudiant') {
            $sql .= ' AND student_id = ?';
            $bindings[] = $query['studentId'];
        }
        if (!empty($query['subjectId'])) {
            $sql .= ' AND subject_id = ?';
            $bindings[] = $query['subjectId'];
        }
        if (!empty($query['subjectIds'])) {
            $ids = array_values(array_filter(array_map('trim', explode(',', (string)$query['subjectIds']))));
            if ($ids) {
                $sql .= ' AND subject_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
                array_push($bindings, ...$ids);
            }
        }
        if (!empty($query['status']) && $user['role'] !== 'etudiant') {
            $sql .= ' AND status = ?';
            $bindings[] = $query['status'];
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        foreach ($rows as $idx => $r) {
            $rows[$idx]['value'] = (float)$r['value'];
        }

        Response::json($rows);
    }

    public function countByStatus(): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $stmt = $db->query('SELECT status, COUNT(*) AS cnt FROM grades GROUP BY status');
        $counts = ['brouillon' => 0, 'validee' => 0];
        while ($row = $stmt->fetch()) {
            $counts[$row['status']] = (int)$row['cnt'];
        }

        Response::json($counts);
    }

    public function gradeSheet(array $params): void
    {
        $user = Auth::requireLogin();
        $subjectId = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('
            SELECT s.id, s.code, s.name, s.coefficient, s.planned_hours AS plannedHours, s.level_id AS levelId, s.semester, s.teacher_id AS teacherId, s.unit_id AS unitId,
                   l.name AS lvl_name, l.label AS lvl_label, f.name AS fil_name, f.code AS fil_code
            FROM subjects s
            JOIN levels l ON l.id = s.level_id
            JOIN filieres f ON f.id = l.filiere_id
            WHERE s.id = ?
        ');
        $stmt->execute([$subjectId]);
        $sub = $stmt->fetch();
        if (!$sub) {
            Response::json(['message' => 'Matière introuvable.'], 404);
        }

        if ($user['role'] === 'enseignant' && $sub['teacherId'] !== $user['profileId']) {
            Response::validationError("Vous n'êtes pas l'enseignant de cette matière.");
        }
        if ($user['role'] === 'etudiant') {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $teacher = null;
        if (!empty($sub['teacherId'])) {
            $tStmt = $db->prepare('SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo FROM teachers WHERE id = ?');
            $tStmt->execute([$sub['teacherId']]);
            $teacher = $tStmt->fetch() ?: null;
            if ($teacher) {
                $teacher['contractHours'] = (int)$teacher['contractHours'];
            }
        }

        // Étudiants de la classe
        $stuStmt = $db->prepare('
            SELECT id, matricule, first_name AS firstName, last_name AS lastName, birth_date AS birthDate, birth_place AS birthPlace, email, phone, filiere_id AS filiereId, level_id AS levelId, photo
            FROM students WHERE level_id = ?
            ORDER BY last_name ASC, first_name ASC
        ');
        $stuStmt->execute([$sub['levelId']]);
        $students = $stuStmt->fetchAll();

        // Notes de cette matière
        $grdStmt = $db->prepare('
            SELECT id, student_id AS studentId, subject_id AS subjectId, type, value, status, entered_by AS enteredBy, entered_at AS enteredAt, validated_by AS validatedBy, validated_at AS validatedAt
            FROM grades WHERE subject_id = ?
        ');
        $grdStmt->execute([$subjectId]);
        $grades = $grdStmt->fetchAll();
        foreach ($grades as $idx => $g) {
            $grades[$idx]['value'] = (float)$g['value'];
        }

        $rows = [];
        foreach ($students as $stu) {
            $sId = $stu['id'];
            $mine = array_values(array_filter($grades, fn($g) => $g['studentId'] === $sId));

            $pick = function (string $type) use ($mine) {
                $found = array_values(array_filter($mine, fn($g) => $g['type'] === $type));
                return !empty($found) ? $found[count($found) - 1] : null;
            };

            $cc = $pick('CC');
            $exam = $pick('EXAMEN');
            $rattrapage = $pick('RATTRAPAGE');

            $validatedMine = array_values(array_filter($mine, fn($g) => $g['status'] === 'validee'));
            $average = Calculations::subjectAverage($validatedMine);

            $eligibleRattrapage = false;
            if ($cc && $exam && $cc['status'] === 'validee' && $exam['status'] === 'validee') {
                $eligibleRattrapage = Calculations::subjectAverage([$cc, $exam]) < 10;
            }

            $rows[] = [
                'student'            => $stu,
                'cc'                 => $cc,
                'exam'               => $exam,
                'rattrapage'         => $rattrapage,
                'average'            => $average,
                'eligibleRattrapage' => $eligibleRattrapage,
            ];
        }

        Response::json([
            'subject' => [
                'id'           => $sub['id'],
                'code'         => $sub['code'],
                'name'         => $sub['name'],
                'coefficient'  => (float)$sub['coefficient'],
                'plannedHours' => (int)$sub['plannedHours'],
                'levelId'      => $sub['levelId'],
                'semester'     => $sub['semester'],
                'teacherId'    => $sub['teacherId'],
                'unitId'       => $sub['unitId'],
            ],
            'cls' => [
                'name'  => $sub['lvl_name'],
                'label' => $sub['lvl_label'] . ' · ' . $sub['fil_name'],
                'short' => $sub['lvl_name'] . ' ' . $sub['fil_code'],
            ],
            'teacher' => $teacher,
            'rows'    => $rows,
        ]);
    }

    public function saveDrafts(array $params, array $body): void
    {
        $user = Auth::requireLogin();
        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $subjectId = $params['id'];
        $type = $params['type'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT * FROM subjects WHERE id = ?');
        $stmt->execute([$subjectId]);
        $subject = $stmt->fetch();
        if (!$subject) {
            Response::validationError('Matière introuvable.');
        }

        if ($user['role'] !== 'enseignant') {
            Response::validationError("Seul l'enseignant de la matière peut saisir et valider les notes.");
        }
        if ($subject['teacher_id'] !== $user['profileId']) {
            Response::validationError("Vous n'êtes pas l'enseignant de cette matière.");
        }
        if (!in_array($type, ['CC', 'EXAMEN', 'RATTRAPAGE'], true)) {
            Response::validationError("Type d'évaluation inconnu.");
        }

        // Récupérer les étudiants de la classe
        $stuStmt = $db->prepare('SELECT id FROM students WHERE level_id = ?');
        $stuStmt->execute([$subject['level_id']]);
        $classStudentIds = array_flip($stuStmt->fetchAll(PDO::FETCH_COLUMN));

        // Récupérer les notes actuelles de la matière
        $grdStmt = $db->prepare('SELECT * FROM grades WHERE subject_id = ?');
        $grdStmt->execute([$subjectId]);
        $currentGrades = $grdStmt->fetchAll();

        $entries = $body['entries'] ?? [];
        if (!is_array($entries)) {
            $entries = [];
        }

        $errors = [];
        $plan = [];

        foreach ($entries as $entry) {
            $studentId = (string)($entry['studentId'] ?? '');
            $valRaw = $entry['value'] ?? '';

            if (!isset($classStudentIds[$studentId])) {
                $errors[$studentId] = "Cet étudiant n'est pas dans la classe de la matière.";
                continue;
            }

            // Note existante
            $existing = null;
            foreach ($currentGrades as $g) {
                if ($g['student_id'] === $studentId && $g['type'] === $type) {
                    $existing = $g;
                    break;
                }
            }

            if ($existing && $existing['status'] === 'validee') {
                $errors[$studentId] = 'Note déjà validée : elle ne peut plus être modifiée.';
                continue;
            }

            $valStr = trim((string)$valRaw);
            if ($valStr === '') {
                if ($existing) {
                    $plan[] = ['studentId' => $studentId, 'existing' => $existing, 'remove' => true];
                }
                continue;
            }

            $numVal = is_numeric(str_replace(',', '.', $valStr)) ? (float)str_replace(',', '.', $valStr) : null;
            if ($numVal === null) {
                $errors[$studentId] = 'Note invalide.';
            } elseif ($numVal < 0 || $numVal > 20) {
                $errors[$studentId] = 'La note doit être comprise entre 0 et 20.';
            } elseif (abs($numVal * 100 - round($numVal * 100)) > 1e-4) {
                $errors[$studentId] = 'Deux décimales au maximum.';
            } elseif ($type === 'RATTRAPAGE') {
                // Éligibilité au rattrapage
                $studentGrades = array_values(array_filter($currentGrades, fn($g) => $g['student_id'] === $studentId));
                $cc = null;
                $exam = null;
                foreach ($studentGrades as $sg) {
                    if ($sg['type'] === 'CC') $cc = $sg;
                    if ($sg['type'] === 'EXAMEN') $exam = $sg;
                }

                $eligible = false;
                if ($cc && $exam && $cc['status'] === 'validee' && $exam['status'] === 'validee') {
                    $avg = Calculations::subjectAverage([$cc, $exam]);
                    $eligible = ($avg !== null && $avg < 10);
                }

                if (!$eligible) {
                    $errors[$studentId] = 'Pas de rattrapage : moyenne supérieure ou égale à 10, ou notes pas encore validées.';
                } else {
                    $plan[] = ['studentId' => $studentId, 'existing' => $existing, 'value' => round($numVal, 2), 'remove' => false];
                }
            } else {
                $plan[] = ['studentId' => $studentId, 'existing' => $existing, 'value' => round($numVal, 2), 'remove' => false];
            }
        }

        if (!empty($errors)) {
            Response::validationError('Certaines notes sont invalides : rien n\'a été enregistré.', $errors);
        }

        $saved = 0;
        $removed = 0;

        $db->beginTransaction();
        try {
            foreach ($plan as $p) {
                if (!empty($p['remove'])) {
                    $delStmt = $db->prepare('DELETE FROM grades WHERE id = ?');
                    $delStmt->execute([$p['existing']['id']]);
                    $removed++;
                } elseif (!empty($p['existing'])) {
                    if ((float)$p['existing']['value'] !== (float)$p['value']) {
                        $saved++;
                    }
                    $updStmt = $db->prepare('
                        UPDATE grades
                        SET value = ?, entered_by = ?, entered_at = ?
                        WHERE id = ?
                    ');
                    $updStmt->execute([$p['value'], $user['id'], $todayStr, $p['existing']['id']]);
                } else {
                    $newId = self::generateId('grd', $db, 'grades');
                    $insStmt = $db->prepare('
                        INSERT INTO grades (id, student_id, subject_id, type, value, status, entered_by, entered_at, validated_by, validated_at)
                        VALUES (?, ?, ?, ?, ?, "brouillon", ?, ?, NULL, NULL)
                    ');
                    $insStmt->execute([$newId, $p['studentId'], $subjectId, $type, $p['value'], $user['id'], $todayStr]);
                    $saved++;
                }
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "L'enregistrement des notes a échoué");
        }

        Response::json(['saved' => $saved, 'removed' => $removed]);
    }

    public function validateGrades(array $params): void
    {
        $user = Auth::requireLogin();
        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $subjectId = $params['id'];
        $type = $params['type'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT * FROM subjects WHERE id = ?');
        $stmt->execute([$subjectId]);
        $subject = $stmt->fetch();
        if (!$subject) {
            Response::validationError('Matière introuvable.');
        }

        if ($user['role'] !== 'enseignant') {
            Response::validationError("Seul l'enseignant de la matière peut saisir et valider les notes.");
        }
        if ($subject['teacher_id'] !== $user['profileId']) {
            Response::validationError("Vous n'êtes pas l'enseignant de cette matière.");
        }
        if (!in_array($type, ['CC', 'EXAMEN', 'RATTRAPAGE'], true)) {
            Response::validationError("Type d'évaluation inconnu.");
        }

        $checkDrafts = $db->prepare('SELECT COUNT(*) FROM grades WHERE subject_id = ? AND type = ? AND status = "brouillon"');
        $checkDrafts->execute([$subjectId, $type]);
        $draftCount = (int)$checkDrafts->fetchColumn();

        if ($draftCount === 0) {
            Response::validationError('Aucune note en brouillon à valider pour cette évaluation.');
        }

        $upd = $db->prepare('
            UPDATE grades
            SET status = "validee", validated_by = ?, validated_at = ?
            WHERE subject_id = ? AND type = ? AND status = "brouillon"
        ');
        $upd->execute([$user['id'], $todayStr, $subjectId, $type]);

        Response::json(['validated' => $draftCount]);
    }

    public function studentHistory(array $params): void
    {
        $user = Auth::requireRole('chef', 'etudiant');
        $studentId = $params['id'];
        $db = Database::getConnection();

        if ($user['role'] === 'etudiant' && $user['profileId'] !== $studentId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $stmt = $db->prepare('
            SELECT g.id, g.student_id AS studentId, g.subject_id AS subjectId, g.type, g.value, g.status,
                   g.entered_by AS enteredBy, g.entered_at AS enteredAt, g.validated_by AS validatedBy, g.validated_at AS validatedAt,
                   s.id AS s_id, s.code AS s_code, s.name AS s_name, s.coefficient AS s_coef, s.planned_hours AS s_hours,
                   s.level_id AS s_level_id, s.semester AS s_semester, s.teacher_id AS s_teacher_id, s.unit_id AS s_unit_id,
                   t.id AS t_id, t.first_name AS t_first_name, t.last_name AS t_last_name, t.grade AS t_grade,
                   t.email AS t_email, t.phone AS t_phone, t.contract_hours AS t_hours, t.photo AS t_photo
            FROM grades g
            JOIN subjects s ON s.id = g.subject_id
            LEFT JOIN teachers t ON t.id = s.teacher_id
            WHERE g.student_id = ? AND g.status = "validee"
            ORDER BY g.validated_at DESC, g.subject_id ASC
        ');
        $stmt->execute([$studentId]);
        $rows = $stmt->fetchAll();

        $history = [];
        foreach ($rows as $r) {
            $teacher = null;
            if (!empty($r['t_id'])) {
                $teacher = [
                    'id'            => $r['t_id'],
                    'firstName'     => $r['t_first_name'],
                    'lastName'      => $r['t_last_name'],
                    'grade'         => $r['t_grade'],
                    'email'         => $r['t_email'],
                    'phone'         => $r['t_phone'],
                    'contractHours' => (int)$r['t_hours'],
                    'photo'         => $r['t_photo'],
                ];
            }

            $history[] = [
                'id'          => $r['id'],
                'studentId'   => $r['studentId'],
                'subjectId'   => $r['subjectId'],
                'type'        => $r['type'],
                'value'       => (float)$r['value'],
                'status'      => $r['status'],
                'enteredBy'   => $r['enteredBy'],
                'enteredAt'   => $r['enteredAt'],
                'validatedBy' => $r['validatedBy'],
                'validatedAt' => $r['validatedAt'],
                'subject'     => [
                    'id'           => $r['s_id'],
                    'code'         => $r['s_code'],
                    'name'         => $r['s_name'],
                    'coefficient'  => (float)$r['s_coef'],
                    'plannedHours' => (int)$r['s_hours'],
                    'levelId'      => $r['s_level_id'],
                    'semester'     => $r['s_semester'],
                    'teacherId'    => $r['s_teacher_id'],
                    'unitId'       => $r['s_unit_id'],
                ],
                'teacher'     => $teacher,
            ];
        }

        Response::json($history);
    }
}

