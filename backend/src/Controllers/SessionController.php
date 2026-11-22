<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';
require_once __DIR__ . '/../Calculations.php';

class SessionController
{
    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    private static function overlaps(string $startA, string $endA, string $startB, string $endB): bool
    {
        $mAStart = Calculations::toMinutes($startA);
        $mAEnd   = Calculations::toMinutes($endA);
        $mBStart = Calculations::toMinutes($startB);
        $mBEnd   = Calculations::toMinutes($endB);

        return ($mAStart < $mBEnd) && ($mBStart < $mAEnd);
    }

    /**
     * Valide une séance (déclaration, absence, correction, confirmation depuis l'emploi du temps).
     * La matière détermine l'enseignant. Public : l'emploi du temps applique exactement les mêmes règles.
     */
    public static function validateSession(
        array $input,
        PDO $db,
        array $config,
        ?string $ownId = null
    ): array {
        $errors = [];
        $subjectId = (string)($input['subjectId'] ?? '');

        $subStmt = $db->prepare('SELECT id, code, level_id, teacher_id FROM subjects WHERE id = ?');
        $subStmt->execute([$subjectId]);
        $subject = $subStmt->fetch();

        if (!$subject) {
            $errors['subjectId'] = 'Choisissez une matière.';
        } elseif (empty($subject['teacher_id'])) {
            $errors['subjectId'] = "Cette matière n'a pas d'enseignant attribué.";
        }

        $date = trim((string)($input['date'] ?? ''));
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $semStart = $config['semester_start'];

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false) {
            $errors['date'] = 'Indiquez la date de la séance.';
        } elseif ($date > $todayStr) {
            $errors['date'] = 'Une séance ne peut pas être enregistrée dans le futur.';
        } elseif ($date < $semStart) {
            $semFormatted = date('d/m/Y', strtotime($semStart));
            $errors['date'] = "Date antérieure au début du semestre ($semFormatted).";
        }

        $start = trim((string)($input['startTime'] ?? ''));
        $end   = trim((string)($input['endTime'] ?? ''));
        $timeRegex = '/^([01]\d|2[0-3]):[0-5]\d$/';

        if (!preg_match($timeRegex, $start)) {
            $errors['startTime'] = "Indiquez l'heure de début (HH:MM).";
        }
        if (!preg_match($timeRegex, $end)) {
            $errors['endTime'] = "Indiquez l'heure de fin (HH:MM).";
        }

        $hours = 0.0;
        if (!isset($errors['startTime']) && !isset($errors['endTime'])) {
            $mStart = Calculations::toMinutes($start);
            $mEnd   = Calculations::toMinutes($end);
            $hours = ($mEnd - $mStart) / 60;

            if ($hours <= 0) {
                $errors['endTime'] = "L'heure de fin doit être postérieure à l'heure de début.";
            } elseif ($hours < 0.5) {
                $errors['endTime'] = 'Durée minimale : 30 minutes.';
            } elseif ($hours > 8) {
                $errors['endTime'] = 'Durée maximale : 8 heures.';
            }
        }

        $note = trim((string)($input['note'] ?? ''));
        if (mb_strlen($note) > 200) {
            $errors['note'] = 'Texte trop long (200 caractères maximum).';
        }

        // Vérification des chevauchements
        if ($subject && !empty($subject['teacher_id']) && empty($errors['date']) && empty($errors['startTime']) && empty($errors['endTime']) && $hours > 0) {
            $sql = '
                SELECT s.id, s.teacher_id, s.subject_id, s.date, s.start_time, s.end_time,
                       sub.code AS sub_code, sub.level_id AS sub_level_id,
                       t.first_name, t.last_name
                FROM sessions s
                JOIN subjects sub ON sub.id = s.subject_id
                JOIN teachers t ON t.id = s.teacher_id
                WHERE s.date = ?
            ';
            $bindings = [$date];
            if ($ownId) {
                $sql .= ' AND s.id != ?';
                $bindings[] = $ownId;
            }

            $chkStmt = $db->prepare($sql);
            $chkStmt->execute($bindings);
            $existingSessions = $chkStmt->fetchAll();

            foreach ($existingSessions as $es) {
                if (self::overlaps($start, $end, $es['start_time'], $es['end_time'])) {
                    $isSameTeacher = ($es['teacher_id'] === $subject['teacher_id']);
                    $isSameClass   = ($es['sub_level_id'] === $subject['level_id']);

                    if ($isSameTeacher) {
                        $dateFr = date('d/m/Y', strtotime($date));
                        $errors['startTime'] = sprintf(
                            'Chevauche une autre séance de cet enseignant le %s : %s-%s (%s).',
                            $dateFr,
                            $es['start_time'],
                            $es['end_time'],
                            $es['sub_code']
                        );
                        break;
                    } elseif ($isSameClass) {
                        $teacherName = $es['first_name'] . ' ' . $es['last_name'];
                        $errors['startTime'] = sprintf(
                            'La classe a déjà cours à cette heure : %s-%s (%s, %s).',
                            $es['start_time'],
                            $es['end_time'],
                            $es['sub_code'],
                            $teacherName
                        );
                        break;
                    }
                }
            }
        }

        return [
            'errors'  => $errors,
            'subject' => $subject,
            'date'    => $date,
            'start'   => $start,
            'end'     => $end,
            'hours'   => $hours,
            'note'    => $note,
        ];
    }

    /** Enregistre une séance validée (présente ou absente) et renvoie sa représentation d'API. */
    public static function insertSession(PDO $db, array $val, string $status, string $actorId, ?string $note): array
    {
        $id = self::generateId('ses', $db, 'sessions');
        $stmt = $db->prepare('
            INSERT INTO sessions (id, teacher_id, subject_id, date, start_time, end_time, status, declared_by, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $id,
            $val['subject']['teacher_id'],
            $val['subject']['id'],
            $val['date'],
            $val['start'],
            $val['end'],
            $status,
            $actorId,
            $note,
        ]);

        return [
            'id'         => $id,
            'teacherId'  => $val['subject']['teacher_id'],
            'subjectId'  => $val['subject']['id'],
            'date'       => $val['date'],
            'startTime'  => $val['start'],
            'endTime'    => $val['end'],
            'status'     => $status,
            'declaredBy' => $actorId,
            'note'       => $note,
        ];
    }

    public function listSessions(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $sql = 'SELECT id, teacher_id AS teacherId, subject_id AS subjectId, date, start_time AS startTime, end_time AS endTime, status, declared_by AS declaredBy, note FROM sessions WHERE 1=1';
        $bindings = [];

        if (!empty($query['teacherId'])) {
            $sql .= ' AND teacher_id = ?';
            $bindings[] = $query['teacherId'];
        }

        if (!empty($query['subjectId'])) {
            $sql .= ' AND subject_id = ?';
            $bindings[] = $query['subjectId'];
        }
        if (!empty($query['status'])) {
            $sql .= ' AND status = ?';
            $bindings[] = $query['status'];
        }
        if (!empty($query['from'])) {
            $sql .= ' AND date >= ?';
            $bindings[] = $query['from'];
        }
        if (!empty($query['to'])) {
            $sql .= ' AND date <= ?';
            $bindings[] = $query['to'];
        }

        $sql .= ' ORDER BY date DESC, start_time DESC';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        Response::json($rows);
    }

    public function detailed(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $sql = '
            SELECT s.id, s.teacher_id AS teacherId, s.subject_id AS subjectId, s.date, s.start_time AS startTime, s.end_time AS endTime, s.status, s.declared_by AS declaredBy, s.note,
                   t.id AS t_id, t.first_name AS t_first_name, t.last_name AS t_last_name, t.grade AS t_grade, t.email AS t_email, t.phone AS t_phone, t.contract_hours AS t_contract_hours, t.photo AS t_photo,
                   sub.id AS sub_id, sub.code AS sub_code, sub.name AS sub_name, sub.coefficient AS sub_coefficient, sub.planned_hours AS sub_planned_hours, sub.level_id AS sub_level_id, sub.semester AS sub_semester, sub.teacher_id AS sub_teacher_id, sub.unit_id AS sub_unit_id,
                   l.id AS l_id, l.name AS l_name, l.label AS l_label, l.filiere_id AS l_filiere_id,
                   f.id AS f_id, f.code AS f_code, f.name AS f_name
            FROM sessions s
            JOIN teachers t ON t.id = s.teacher_id
            JOIN subjects sub ON sub.id = s.subject_id
            JOIN levels l ON l.id = sub.level_id
            JOIN filieres f ON f.id = l.filiere_id
            WHERE 1=1
        ';
        $bindings = [];

        if (!empty($query['teacherId'])) {
            $sql .= ' AND s.teacher_id = ?';
            $bindings[] = $query['teacherId'];
        }

        if (!empty($query['subjectId'])) {
            $sql .= ' AND s.subject_id = ?';
            $bindings[] = $query['subjectId'];
        }
        if (!empty($query['status'])) {
            $sql .= ' AND s.status = ?';
            $bindings[] = $query['status'];
        }
        if (!empty($query['from'])) {
            $sql .= ' AND s.date >= ?';
            $bindings[] = $query['from'];
        }
        if (!empty($query['to'])) {
            $sql .= ' AND s.date <= ?';
            $bindings[] = $query['to'];
        }

        $sql .= ' ORDER BY s.date DESC, s.start_time DESC';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        $detailed = [];
        foreach ($rows as $r) {
            $hours = Calculations::sessionHours($r);

            $detailed[] = [
                'id'         => $r['id'],
                'teacherId'  => $r['teacherId'],
                'subjectId'  => $r['subjectId'],
                'date'       => $r['date'],
                'startTime'  => $r['startTime'],
                'endTime'    => $r['endTime'],
                'status'     => $r['status'],
                'declaredBy' => $r['declaredBy'],
                'note'       => $r['note'],
                'hours'      => $hours,
                'teacher'    => [
                    'id'            => $r['t_id'],
                    'firstName'     => $r['t_first_name'],
                    'lastName'      => $r['t_last_name'],
                    'grade'         => $r['t_grade'],
                    'email'         => $r['t_email'],
                    'phone'         => $r['t_phone'],
                    'contractHours' => (int)$r['t_contract_hours'],
                    'photo'         => $r['t_photo'],
                ],
                'subject'    => [
                    'id'           => $r['sub_id'],
                    'code'         => $r['sub_code'],
                    'name'         => $r['sub_name'],
                    'coefficient'  => (float)$r['sub_coefficient'],
                    'plannedHours' => (int)$r['sub_planned_hours'],
                    'levelId'      => $r['sub_level_id'],
                    'semester'     => $r['sub_semester'],
                    'teacherId'    => $r['sub_teacher_id'],
                    'unitId'       => $r['sub_unit_id'],
                ],
                'cls'        => [
                    'id'        => $r['l_id'],
                    'name'      => $r['l_name'],
                    'label'     => $r['l_name'] . ' · ' . $r['f_name'],
                    'filiereId' => $r['l_filiere_id'],
                    'filiere'   => [
                        'id'   => $r['f_id'],
                        'code' => $r['f_code'],
                        'name' => $r['f_name'],
                    ],
                    'short'     => $r['l_name'] . ' ' . $r['f_code'],
                ],
            ];
        }

        Response::json($detailed);
    }

    public function stats(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $sql = 'SELECT id, start_time AS startTime, end_time AS endTime, status FROM sessions WHERE 1=1';
        $bindings = [];

        if (!empty($query['teacherId'])) {
            $sql .= ' AND teacher_id = ?';
            $bindings[] = $query['teacherId'];
        }

        if (!empty($query['subjectId'])) {
            $sql .= ' AND subject_id = ?';
            $bindings[] = $query['subjectId'];
        }
        if (!empty($query['status'])) {
            $sql .= ' AND status = ?';
            $bindings[] = $query['status'];
        }
        if (!empty($query['from'])) {
            $sql .= ' AND date >= ?';
            $bindings[] = $query['from'];
        }
        if (!empty($query['to'])) {
            $sql .= ' AND date <= ?';
            $bindings[] = $query['to'];
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $sessions = $stmt->fetchAll();

        $presentSessions = array_values(array_filter($sessions, fn($s) => $s['status'] === 'present'));
        $totalHours = 0.0;
        foreach ($presentSessions as $s) {
            $totalHours += Calculations::sessionHours($s);
        }
        $scheduledHours = 0.0;
        foreach ($sessions as $s) {
            $scheduledHours += Calculations::sessionHours($s);
        }

        $rate = Calculations::presenceRate($sessions);

        Response::json([
            'total'          => count($sessions),
            'present'        => count($presentSessions),
            'absent'         => count($sessions) - count($presentSessions),
            'rate'           => $rate,
            'hours'          => Calculations::round2($totalHours),
            'scheduledHours' => Calculations::round2($scheduledHours),
        ]);
    }

    public function getSession(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id, teacher_id AS teacherId, subject_id AS subjectId, date, start_time AS startTime, end_time AS endTime, status, declared_by AS declaredBy, note FROM sessions WHERE id = ?');
        $stmt->execute([$id]);
        $session = $stmt->fetch();

        if (!$session) {
            Response::json(['message' => 'Séance introuvable.'], 404);
        }

        Response::json($session);
    }

    /** Le chef déclare une séance effectuée pour l'enseignant de la matière (statut « présent »). */
    public function declareSession(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $val = self::validateSession($body, $db, $config);
        if (!empty($val['errors'])) {
            Response::validationError('Veuillez corriger les champs signalés.', $val['errors']);
        }

        Response::json(self::insertSession($db, $val, 'present', $user['id'], $val['note'] ?: null), 201);
    }

    /** Le chef enregistre l'absence d'un enseignant (la raison est facultative). */
    public function recordAbsence(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $val = self::validateSession($body, $db, $config);
        if (!empty($val['errors'])) {
            Response::validationError('Veuillez corriger les champs signalés.', $val['errors']);
        }

        $note = $val['note'] !== '' ? $val['note'] : 'Raison non communiquée';
        Response::json(self::insertSession($db, $val, 'absent', $user['id'], $note), 201);
    }

    public function updateSession(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT * FROM sessions WHERE id = ?');
        $stmt->execute([$id]);
        $session = $stmt->fetch();
        if (!$session) {
            Response::validationError('Séance introuvable.');
        }

        $val = self::validateSession($body, $db, $config, $id);

        $status = $body['status'] ?? $session['status'];
        if (!in_array($status, ['present', 'absent'], true)) {
            $val['errors']['status'] = 'Statut invalide.';
        }

        if (!empty($val['errors'])) {
            Response::validationError('Veuillez corriger les champs signalés.', $val['errors']);
        }

        $note = $val['note'] !== '' ? $val['note'] : ($status === 'absent' ? 'Raison non communiquée' : null);

        $upd = $db->prepare('
            UPDATE sessions
            SET teacher_id = ?, subject_id = ?, date = ?, start_time = ?, end_time = ?, status = ?, note = ?
            WHERE id = ?
        ');
        $upd->execute([
            $val['subject']['teacher_id'],
            $val['subject']['id'],
            $val['date'],
            $val['start'],
            $val['end'],
            $status,
            $note,
            $id
        ]);

        Response::json([
            'id'         => $id,
            'teacherId'  => $val['subject']['teacher_id'],
            'subjectId'  => $val['subject']['id'],
            'date'       => $val['date'],
            'startTime'  => $val['start'],
            'endTime'    => $val['end'],
            'status'     => $status,
            'declaredBy' => $session['declared_by'],
            'note'       => $note,
        ]);
    }

    public function deleteSession(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id FROM sessions WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            Response::validationError('Séance introuvable.');
        }

        $del = $db->prepare('DELETE FROM sessions WHERE id = ?');
        $del->execute([$id]);

        Response::noContent();
    }

    public function teacherHours(array $params): void
    {
        Auth::requireRole('chef');
        $teacherId = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $period = "{$config['current_semester']}-{$config['academic_year']}";
        $db = Database::getConnection();

        $tStmt = $db->prepare('SELECT id, contract_hours FROM teachers WHERE id = ?');
        $tStmt->execute([$teacherId]);
        $teacher = $tStmt->fetch();
        if (!$teacher) {
            Response::json(['message' => 'Enseignant introuvable.'], 404);
        }

        $subjectsStmt = $db->prepare('SELECT id, teacher_id, planned_hours FROM subjects WHERE teacher_id = ?');
        $subjectsStmt->execute([$teacherId]);
        $subjects = $subjectsStmt->fetchAll();
        $sessionsStmt = $db->prepare('SELECT id, teacher_id, start_time, end_time, status FROM sessions WHERE teacher_id = ?');
        $sessionsStmt->execute([$teacherId]);
        $sessions = $sessionsStmt->fetchAll();

        $summary = Calculations::hoursSummary($teacher, $subjects, $sessions, $period);
        Response::json($summary);
    }

    public function allHours(): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $period = "{$config['current_semester']}-{$config['academic_year']}";
        $db = Database::getConnection();

        $teachers = $db->query('SELECT id, contract_hours FROM teachers ORDER BY last_name ASC')->fetchAll();
        $subjects = $db->query('SELECT id, teacher_id, planned_hours FROM subjects')->fetchAll();
        $sessions = $db->query('SELECT id, teacher_id, start_time, end_time, status FROM sessions')->fetchAll();

        $summaries = [];
        foreach ($teachers as $t) {
            $summaries[] = Calculations::hoursSummary($t, $subjects, $sessions, $period);
        }

        Response::json($summaries);
    }
}

