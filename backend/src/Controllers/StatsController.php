<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Calculations.php';

class StatsController
{
    private static function inRange(array $sessions, ?string $from, ?string $to): array
    {
        return array_values(array_filter($sessions, function ($s) use ($from, $to) {
            $date = $s['date'];
            if ($from && $date < $from) return false;
            if ($to && $date > $to) return false;
            return true;
        }));
    }

    public function teachingWeekly(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'enseignant');
        $teacherId = $query['teacherId'] ?? null;
        if ($user['role'] === 'enseignant') {
            $teacherId = $user['profileId'];
        }

        $db = Database::getConnection();
        $sql = 'SELECT id, teacher_id, date, start_time, end_time, status FROM sessions WHERE 1=1';
        $bindings = [];

        if ($teacherId) {
            $sql .= ' AND teacher_id = ?';
            $bindings[] = $teacherId;
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $sessions = $stmt->fetchAll();

        $inPeriod = self::inRange($sessions, $query['from'] ?? null, $query['to'] ?? null);

        $weeks = [];
        foreach ($inPeriod as $s) {
            $wKey = Calculations::weekStart($s['date']);
            if (!isset($weeks[$wKey])) {
                $weeks[$wKey] = [
                    'week'     => $wKey,
                    'hours'    => 0.0,
                    'absences' => 0,
                    'present'  => 0,
                    'sessions' => 0,
                ];
            }

            $weeks[$wKey]['sessions']++;
            if ($s['status'] === 'present') {
                $weeks[$wKey]['present']++;
                $weeks[$wKey]['hours'] += Calculations::sessionHours($s);
            } else {
                $weeks[$wKey]['absences']++;
            }
        }

        ksort($weeks);

        $result = [];
        foreach ($weeks as $w) {
            $rate = $w['sessions'] > 0 ? round(($w['present'] / $w['sessions']) * 100, 1) : 0.0;
            $result[] = [
                'week'     => $w['week'],
                'hours'    => Calculations::round2($w['hours']),
                'absences' => $w['absences'],
                'present'  => $w['present'],
                'sessions' => $w['sessions'],
                'rate'     => $rate,
            ];
        }

        Response::json($result);
    }

    public function classAverages(): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $levels = $db->query('
            SELECT l.id, l.name, l.label AS levelLabel, f.code AS f_code, f.name AS f_name
            FROM levels l
            JOIN filieres f ON f.id = l.filiere_id
            ORDER BY l.id
        ')->fetchAll();

        $students = $db->query('SELECT id, level_id FROM students')->fetchAll();
        $grades = $db->query('SELECT student_id, type, value FROM grades WHERE status = "validee"')->fetchAll();

        $result = [];
        foreach ($levels as $l) {
            $stuIds = array_flip(array_column(array_filter($students, fn($s) => $s['level_id'] === $l['id']), 'id'));

            $ccVals = [];
            $examVals = [];
            foreach ($grades as $g) {
                if (isset($stuIds[$g['student_id']])) {
                    if ($g['type'] === 'CC') {
                        $ccVals[] = (float)$g['value'];
                    } elseif ($g['type'] === 'EXAMEN') {
                        $examVals[] = (float)$g['value'];
                    }
                }
            }

            $result[] = [
                'levelId' => $l['id'],
                'label'   => "{$l['name']} {$l['f_code']}",
                'name'    => "{$l['levelLabel']} · {$l['f_name']}",
                'cc'      => Calculations::mean($ccVals),
                'exam'    => Calculations::mean($examVals),
            ];
        }

        Response::json($result);
    }

    public function gradeProgress(): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $grades = $db->query('SELECT type, value FROM grades WHERE status = "validee"')->fetchAll();
        $ccVals = [];
        $examVals = [];

        foreach ($grades as $g) {
            if ($g['type'] === 'CC') {
                $ccVals[] = (float)$g['value'];
            } elseif ($g['type'] === 'EXAMEN') {
                $examVals[] = (float)$g['value'];
            }
        }

        Response::json([
            'cc'   => Calculations::mean($ccVals),
            'exam' => Calculations::mean($examVals),
        ]);
    }

    public function departmentResults(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $semester = $query['semester'] ?? $config['current_semester'];
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        // On réutilise la logique de BulletinController pour calculer les résultats en direct
        $rattrapageOpen = (int)Database::scalar("SELECT COUNT(*) FROM events WHERE type = 'rattrapage' AND start > ?", [$todayStr]) > 0;

        $students = $db->query('SELECT id, level_id FROM students')->fetchAll();
        $subjectsStmt = $db->prepare('SELECT id, code, name, coefficient, level_id, semester, unit_id FROM subjects WHERE semester = ?');
        $subjectsStmt->execute([$semester]);
        $subjects = $subjectsStmt->fetchAll();
        $grades = $db->query('SELECT student_id, subject_id, type, value, status FROM grades')->fetchAll();
        // `rank` et `lines` sont des mots réservés de MySQL : toujours entre apostrophes inverses
        $bulletinsStmt = $db->prepare('SELECT student_id, average, `rank`, class_ranked, `lines`, units, credits FROM bulletins WHERE semester = ?');
        $bulletinsStmt->execute([$semester]);
        $bulletins = $bulletinsStmt->fetchAll();
        $unitsStmt = $db->prepare('SELECT id, code, name, type, level_id, semester FROM units WHERE semester = ?');
        $unitsStmt->execute([$semester]);
        $units = $unitsStmt->fetchAll();

        $byLevel = [];
        $counts = ['Admis' => 0, 'Rattrapage' => 0, 'Ajourné' => 0, 'Incomplet' => 0];
        $pendingBulletins = 0;

        foreach ($students as $student) {
            $lvlId = $student['level_id'];
            if (!isset($byLevel[$lvlId])) {
                $subLvl = array_values(array_filter($subjects, fn($s) => $s['level_id'] === $lvlId));
                $unitsLvl = array_values(array_filter($units, fn($u) => $u['level_id'] === $lvlId));
                $stuLvl = array_values(array_filter($students, fn($s) => $s['level_id'] === $lvlId));

                $cm = [];
                foreach ($stuLvl as $st) {
                    $sGrd = array_values(array_filter($grades, fn($g) => $g['student_id'] === $st['id']));
                    $cm[] = [
                        'studentId' => $st['id'],
                        'report'    => Calculations::buildReport($subLvl, $sGrd, $rattrapageOpen, $unitsLvl),
                    ];
                }
                $byLevel[$lvlId] = $cm;
            }

            $report = null;
            foreach ($byLevel[$lvlId] as $c) {
                if ($c['studentId'] === $student['id']) {
                    $report = $c['report'];
                    break;
                }
            }

            $counts[$report['result']] = ($counts[$report['result']] ?? 0) + 1;

            // Bulletin existant
            $b = null;
            foreach ($bulletins as $blt) {
                if ($blt['student_id'] === $student['id']) {
                    $b = $blt;
                    break;
                }
            }

            $live = (!empty($report['complete'])) ? Calculations::bulletinSnapshot($report, $byLevel[$lvlId]) : null;

            $status = 'incomplete';
            if ($b) {
                $formattedB = [
                    'average'     => $b['average'] !== null ? (float)$b['average'] : null,
                    'rank'        => $b['rank'] !== null ? (int)$b['rank'] : null,
                    'classRanked' => $b['class_ranked'] !== null ? (int)$b['class_ranked'] : null,
                    'credits'     => is_string($b['credits']) ? json_decode($b['credits'], true) : $b['credits'],
                    'units'       => is_string($b['units']) ? json_decode($b['units'], true) : $b['units'],
                    'lines'       => is_string($b['lines']) ? json_decode($b['lines'], true) : $b['lines'],
                ];
                $status = ($live && Calculations::sameResults($formattedB, $live)) ? 'generated' : 'outdated';
            } else {
                $status = (!empty($report['complete'])) ? 'ready' : 'incomplete';
            }

            if ($status === 'ready' || $status === 'outdated') {
                $pendingBulletins++;
            }
        }

        Response::json([
            'counts'           => $counts,
            'total'            => count($students),
            'pendingBulletins' => $pendingBulletins,
        ]);
    }

    public function recentAbsences(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();
        $limit = !empty($query['limit']) ? (int)$query['limit'] : 5;

        $stmt = $db->query('
            SELECT s.id, s.teacher_id AS teacherId, s.subject_id AS subjectId, s.date, s.start_time AS startTime, s.end_time AS endTime, s.status, s.declared_by AS declaredBy, s.note,
                   t.id AS t_id, t.first_name AS t_first_name, t.last_name AS t_last_name, t.grade AS t_grade, t.email AS t_email, t.phone AS t_phone, t.contract_hours AS t_contract_hours, t.photo AS t_photo,
                   sub.id AS sub_id, sub.code AS sub_code, sub.name AS sub_name, sub.coefficient AS sub_coefficient, sub.planned_hours AS sub_planned_hours, sub.level_id AS sub_level_id, sub.semester AS sub_semester, sub.teacher_id AS sub_teacher_id, sub.unit_id AS sub_unit_id
            FROM sessions s
            JOIN teachers t ON t.id = s.teacher_id
            JOIN subjects sub ON sub.id = s.subject_id
            WHERE s.status = "absent"
            ORDER BY s.date DESC, s.start_time DESC
        ');
        $rows = $stmt->fetchAll();

        $inPeriod = self::inRange($rows, $query['from'] ?? null, $query['to'] ?? null);
        $sliced = array_slice($inPeriod, 0, $limit);

        $result = [];
        foreach ($sliced as $r) {
            $result[] = [
                'id'         => $r['id'],
                'teacherId'  => $r['teacherId'],
                'subjectId'  => $r['subjectId'],
                'date'       => $r['date'],
                'startTime'  => $r['startTime'],
                'endTime'    => $r['endTime'],
                'status'     => $r['status'],
                'declaredBy' => $r['declaredBy'],
                'note'       => $r['note'],
                'hours'      => Calculations::sessionHours($r),
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
            ];
        }

        Response::json($result);
    }

    public function hoursProgress(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();
        $limit = !empty($query['limit']) ? (int)$query['limit'] : 6;

        $teachers = $db->query('
            SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo
            FROM teachers
        ')->fetchAll();
        foreach ($teachers as $idx => $t) {
            $teachers[$idx]['contractHours'] = (int)$t['contractHours'];
        }

        $sessions = $db->query('SELECT teacher_id, date, start_time, end_time, status FROM sessions')->fetchAll();
        $inPeriod = self::inRange($sessions, $query['from'] ?? null, $query['to'] ?? null);

        $rows = [];
        foreach ($teachers as $t) {
            $own = array_values(array_filter($inPeriod, fn($s) => $s['teacher_id'] === $t['id']));

            $plannedHours = 0.0;
            $doneHours = 0.0;
            foreach ($own as $s) {
                $h = Calculations::sessionHours($s);
                $plannedHours += $h;
                if ($s['status'] === 'present') {
                    $doneHours += $h;
                }
            }

            $planned = Calculations::round2($plannedHours);
            $done    = Calculations::round2($doneHours);
            $percent = $planned > 0 ? (int)round(($done / $planned) * 100) : 100;

            if ($planned > 0) {
                $rows[] = [
                    'teacher' => $t,
                    'planned' => $planned,
                    'done'    => $done,
                    'percent' => $percent,
                ];
            }
        }

        usort($rows, fn($a, $b) => $a['percent'] <=> $b['percent']);
        $sliced = array_slice($rows, 0, $limit);

        Response::json($sliced);
    }

    public function subjectRows(): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $subjects = $db->query('
            SELECT s.id, s.code, s.name, s.coefficient, s.planned_hours AS plannedHours, s.level_id AS levelId, s.semester, s.teacher_id AS teacherId, s.unit_id AS unitId,
                   l.id AS l_id, l.name AS l_name, l.label AS l_label, l.filiere_id AS l_filiere_id,
                   f.id AS f_id, f.code AS f_code, f.name AS f_name,
                   t.id AS t_id, t.first_name AS t_first_name, t.last_name AS t_last_name, t.grade AS t_grade, t.email AS t_email, t.phone AS t_phone, t.contract_hours AS t_contract_hours, t.photo AS t_photo
            FROM subjects s
            JOIN levels l ON l.id = s.level_id
            JOIN filieres f ON f.id = l.filiere_id
            LEFT JOIN teachers t ON t.id = s.teacher_id
            ORDER BY s.code ASC
        ')->fetchAll();

        $students = $db->query('SELECT id, level_id FROM students')->fetchAll();
        $grades = $db->query('SELECT subject_id, type, status FROM grades WHERE type != "RATTRAPAGE"')->fetchAll();

        $result = [];
        foreach ($subjects as $s) {
            $classCount = count(array_filter($students, fn($st) => $st['level_id'] === $s['levelId']));
            $ownGrades = array_values(array_filter($grades, fn($g) => $g['subject_id'] === $s['id']));
            $validatedCount = count(array_filter($ownGrades, fn($g) => $g['status'] === 'validee'));

            $teacher = null;
            if (!empty($s['t_id'])) {
                $teacher = [
                    'id'            => $s['t_id'],
                    'firstName'     => $s['t_first_name'],
                    'lastName'      => $s['t_last_name'],
                    'grade'         => $s['t_grade'],
                    'email'         => $s['t_email'],
                    'phone'         => $s['t_phone'],
                    'contractHours' => (int)$s['t_contract_hours'],
                    'photo'         => $s['t_photo'],
                ];
            }

            $result[] = [
                'subject' => [
                    'id'           => $s['id'],
                    'code'         => $s['code'],
                    'name'         => $s['name'],
                    'coefficient'  => (float)$s['coefficient'],
                    'plannedHours' => (int)$s['plannedHours'],
                    'levelId'      => $s['levelId'],
                    'semester'     => $s['semester'],
                    'teacherId'    => $s['teacherId'],
                    'unitId'       => $s['unitId'],
                ],
                'cls' => [
                    'id'        => $s['l_id'],
                    'name'      => $s['l_name'],
                    'label'     => "{$s['l_name']} · {$s['f_name']}",
                    'filiereId' => $s['l_filiere_id'],
                    'filiere'   => [
                        'id'   => $s['f_id'],
                        'code' => $s['f_code'],
                        'name' => $s['f_name'],
                    ],
                    'short'     => "{$s['l_name']} {$s['f_code']}",
                ],
                'teacher'   => $teacher,
                'students'  => $classCount,
                'expected'  => $classCount * 2,
                'entered'   => count($ownGrades),
                'validated' => $validatedCount,
            ];
        }

        Response::json($result);
    }

    public function teacherRows(): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $period = "{$config['current_semester']}-{$config['academic_year']}";
        $db = Database::getConnection();

        $teachers = $db->query('
            SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo
            FROM teachers ORDER BY last_name ASC, first_name ASC
        ')->fetchAll();
        foreach ($teachers as $idx => $t) {
            $teachers[$idx]['contractHours'] = (int)$t['contractHours'];
        }

        $subjects = $db->query('SELECT id, code, name, coefficient, planned_hours AS plannedHours, level_id AS levelId, semester, teacher_id AS teacherId, unit_id AS unitId FROM subjects')->fetchAll();
        foreach ($subjects as $idx => $sb) {
            $subjects[$idx]['coefficient'] = (float)$sb['coefficient'];
            $subjects[$idx]['plannedHours'] = (int)$sb['plannedHours'];
        }

        $sessions = $db->query('SELECT teacher_id, date, start_time, end_time, status FROM sessions')->fetchAll();

        $rows = [];
        foreach ($teachers as $t) {
            $tSubjects = array_values(array_filter($subjects, fn($s) => $s['teacherId'] === $t['id']));
            $tSessions = array_values(array_filter($sessions, fn($s) => $s['teacher_id'] === $t['id']));

            $hours = Calculations::hoursSummary($t, $subjects, $sessions, $period);
            $rate = Calculations::presenceRate($tSessions);
            $absences = count(array_filter($tSessions, fn($s) => $s['status'] === 'absent'));

            $rows[] = [
                'teacher'  => $t,
                'subjects' => $tSubjects,
                'hours'    => $hours,
                'rate'     => $rate,
                'absences' => $absences,
            ];
        }

        Response::json($rows);
    }

    public function hoursOverview(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $period = "{$config['current_semester']}-{$config['academic_year']}";
        $db = Database::getConnection();

        $teachers = $db->query('
            SELECT id, first_name AS firstName, last_name AS lastName, grade, email, phone, contract_hours AS contractHours, photo
            FROM teachers ORDER BY last_name ASC, first_name ASC
        ')->fetchAll();
        foreach ($teachers as $idx => $t) {
            $teachers[$idx]['contractHours'] = (int)$t['contractHours'];
        }

        $subjects = $db->query('SELECT id, teacher_id, planned_hours FROM subjects')->fetchAll();
        $sessions = $db->query('SELECT teacher_id, date, start_time, end_time, status FROM sessions')->fetchAll();

        $inPeriod = self::inRange($sessions, $query['from'] ?? null, $query['to'] ?? null);

        $rows = [];
        foreach ($teachers as $t) {
            $ownPeriod = array_values(array_filter($inPeriod, fn($s) => $s['teacher_id'] === $t['id']));
            $present = array_values(array_filter($ownPeriod, fn($s) => $s['status'] === 'present'));

            $doneH = 0.0;
            foreach ($present as $s) {
                $doneH += Calculations::sessionHours($s);
            }
            $schedH = 0.0;
            foreach ($ownPeriod as $s) {
                $schedH += Calculations::sessionHours($s);
            }

            $done = Calculations::round2($doneH);
            $scheduled = Calculations::round2($schedH);
            $absentHours = Calculations::round2($scheduled - $done);
            $absences = count($ownPeriod) - count($present);
            $rate = $scheduled > 0 ? round(($done / $scheduled) * 100, 1) : null;

            $semester = Calculations::hoursSummary($t, $subjects, $sessions, $period);

            $rows[] = [
                'teacher'      => $t,
                'done'         => $done,
                'scheduled'    => $scheduled,
                'absentHours'  => $absentHours,
                'sessions'     => count($ownPeriod),
                'absences'     => $absences,
                'rate'         => $rate,
                'contract'     => $semester['contract'],
                'planned'      => $semester['planned'],
                'semesterDone' => $semester['done'],
                'overtime'     => $semester['overtime'],
                'missing'      => $semester['missing'],
            ];
        }

        $sum = fn(string $k) => Calculations::round2(array_sum(array_column($rows, $k)));
        $totScheduled = $sum('scheduled');
        $totDone = $sum('done');

        $totals = [
            'done'        => $totDone,
            'scheduled'   => $totScheduled,
            'absentHours' => $sum('absentHours'),
            'absences'    => (int)array_sum(array_column($rows, 'absences')),
            'sessions'    => (int)array_sum(array_column($rows, 'sessions')),
            'overtime'    => $sum('overtime'),
            'missing'     => $sum('missing'),
            'rate'        => $totScheduled > 0 ? round(($totDone / $totScheduled) * 100, 1) : null,
        ];

        Response::json(['rows' => $rows, 'totals' => $totals]);
    }

    public function teacherRecentSessions(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'enseignant');
        $teacherId = $params['id'];
        if ($user['role'] === 'enseignant' && $user['profileId'] !== $teacherId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $db = Database::getConnection();
        $limit = !empty($query['limit']) ? (int)$query['limit'] : 5;

        $stmt = $db->prepare('
            SELECT s.id, s.teacher_id AS teacherId, s.subject_id AS subjectId, s.date, s.start_time AS startTime, s.end_time AS endTime, s.status, s.declared_by AS declaredBy, s.note,
                   sub.id AS sub_id, sub.code AS sub_code, sub.name AS sub_name, sub.coefficient AS sub_coefficient, sub.planned_hours AS sub_planned_hours, sub.level_id AS sub_level_id, sub.semester AS sub_semester, sub.teacher_id AS sub_teacher_id, sub.unit_id AS sub_unit_id
            FROM sessions s
            JOIN subjects sub ON sub.id = s.subject_id
            WHERE s.teacher_id = ?
            ORDER BY s.date DESC, s.start_time DESC
        ');
        $stmt->execute([$teacherId]);
        $rows = $stmt->fetchAll();

        $inPeriod = self::inRange($rows, $query['from'] ?? null, $query['to'] ?? null);
        $sliced = array_slice($inPeriod, 0, $limit);

        $result = [];
        foreach ($sliced as $r) {
            $result[] = [
                'id'         => $r['id'],
                'teacherId'  => $r['teacherId'],
                'subjectId'  => $r['subjectId'],
                'date'       => $r['date'],
                'startTime'  => $r['startTime'],
                'endTime'    => $r['endTime'],
                'status'     => $r['status'],
                'declaredBy' => $r['declaredBy'],
                'note'       => $r['note'],
                'hours'      => Calculations::sessionHours($r),
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
            ];
        }

        Response::json($result);
    }

    public function teacherOverview(array $params): void
    {
        $user = Auth::requireRole('chef', 'enseignant');
        $teacherId = $params['id'];
        if ($user['role'] === 'enseignant' && $user['profileId'] !== $teacherId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $db = Database::getConnection();

        $subStmt = $db->prepare('
            SELECT s.id, s.code, s.name, s.coefficient, s.planned_hours AS plannedHours, s.level_id AS levelId, s.semester, s.teacher_id AS teacherId, s.unit_id AS unitId,
                   l.name AS lvl_name, l.label AS lvl_label, f.code AS fil_code, f.name AS fil_name
            FROM subjects s
            JOIN levels l ON l.id = s.level_id
            JOIN filieres f ON f.id = l.filiere_id
            WHERE s.teacher_id = ?
            ORDER BY s.code ASC
        ');
        $subStmt->execute([$teacherId]);
        $ownSubjects = $subStmt->fetchAll();

        $students = $db->query('SELECT id, level_id FROM students')->fetchAll();
        $grades = $db->query('SELECT subject_id, type, value, status FROM grades')->fetchAll();
        $sessionsStmt = $db->prepare("SELECT subject_id, start_time, end_time, status FROM sessions WHERE teacher_id = ? AND status = 'present'");
        $sessionsStmt->execute([$teacherId]);
        $sessions = $sessionsStmt->fetchAll();

        $rows = [];
        foreach ($ownSubjects as $sb) {
            $subId = $sb['id'];
            $lvlId = $sb['levelId'];

            $classCount = count(array_filter($students, fn($st) => $st['level_id'] === $lvlId));
            $ownGrades = array_values(array_filter($grades, fn($g) => $g['subject_id'] === $subId && $g['type'] !== 'RATTRAPAGE'));
            $validatedGrades = array_values(array_filter($ownGrades, fn($g) => $g['status'] === 'validee'));

            $ccVals = array_column(array_filter($validatedGrades, fn($g) => $g['type'] === 'CC'), 'value');
            $examVals = array_column(array_filter($validatedGrades, fn($g) => $g['type'] === 'EXAMEN'), 'value');

            $doneH = 0.0;
            foreach ($sessions as $ses) {
                if ($ses['subject_id'] === $subId) {
                    $doneH += Calculations::sessionHours($ses);
                }
            }

            $rows[] = [
                'subject' => [
                    'id'           => $sb['id'],
                    'code'         => $sb['code'],
                    'name'         => $sb['name'],
                    'coefficient'  => (float)$sb['coefficient'],
                    'plannedHours' => (int)$sb['plannedHours'],
                    'levelId'      => $sb['levelId'],
                    'semester'     => $sb['semester'],
                    'teacherId'    => $sb['teacherId'],
                    'unitId'       => $sb['unitId'],
                ],
                'className'  => "{$sb['lvl_name']} {$sb['fil_code']}",
                'classLabel' => "{$sb['lvl_label']} · {$sb['fil_name']}",
                'students'   => $classCount,
                'expected'   => $classCount * 2,
                'hoursDone'  => Calculations::round2($doneH),
                'cc'         => Calculations::mean($ccVals),
                'exam'       => Calculations::mean($examVals),
                'entered'    => count($ownGrades),
                'validated'  => count($validatedGrades),
            ];
        }

        $ownSubjectIds = array_flip(array_column($ownSubjects, 'id'));
        $validatedExams = [];
        foreach ($grades as $g) {
            if (isset($ownSubjectIds[$g['subject_id']]) && $g['status'] === 'validee' && $g['type'] === 'EXAMEN') {
                $validatedExams[] = (float)$g['value'];
            }
        }

        $drafts = 0;
        foreach ($rows as $r) {
            $drafts += ($r['entered'] - $r['validated']);
        }

        Response::json([
            'rows'      => $rows,
            'drafts'    => $drafts,
            'cc'        => Calculations::mean(array_column($rows, 'cc')),
            'exam'      => Calculations::mean(array_column($rows, 'exam')),
            'examBands' => [
                'low'  => count(array_filter($validatedExams, fn($v) => $v < 10)),
                'mid'  => count(array_filter($validatedExams, fn($v) => $v >= 10 && $v < 14)),
                'high' => count(array_filter($validatedExams, fn($v) => $v >= 14)),
            ],
        ]);
    }

    public function studentOverview(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'etudiant');
        $studentId = $params['id'];
        if ($user['role'] === 'etudiant' && $user['profileId'] !== $studentId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $config = require __DIR__ . '/../../config/config.php';
        $semester = $query['semester'] ?? $config['current_semester'];
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $stuStmt = $db->prepare('
            SELECT s.id, s.matricule, s.first_name AS firstName, s.last_name AS lastName, s.birth_date AS birthDate,
                   s.birth_place AS birthPlace, s.email, s.phone, s.filiere_id AS filiereId, s.level_id AS levelId, s.photo,
                   l.label AS lvl_label, f.name AS fil_name
            FROM students s
            JOIN levels l ON l.id = s.level_id
            JOIN filieres f ON f.id = l.filiere_id
            WHERE s.id = ?
        ');
        $stuStmt->execute([$studentId]);
        $student = $stuStmt->fetch();
        if (!$student) {
            Response::json(['message' => 'Étudiant introuvable.'], 404);
        }

        $levelId = $student['levelId'];
        $className = "{$student['lvl_label']} · {$student['fil_name']}";

        $rattrapageOpen = (int)Database::scalar("SELECT COUNT(*) FROM events WHERE type = 'rattrapage' AND start > ?", [$todayStr]) > 0;

        $subStmt = $db->prepare('SELECT id, code, name, coefficient, level_id, semester, unit_id FROM subjects WHERE level_id = ? AND semester = ?');
        $subStmt->execute([$levelId, $semester]);
        $subjects = $subStmt->fetchAll();
        foreach ($subjects as $idx => $s) {
            $subjects[$idx]['coefficient'] = (float)$s['coefficient'];
        }

        $unitsStmt = $db->prepare('SELECT id, code, name, type, level_id, semester FROM units WHERE level_id = ? AND semester = ?');
        $unitsStmt->execute([$levelId, $semester]);
        $units = $unitsStmt->fetchAll();

        $classmatesStmt = $db->prepare('SELECT id FROM students WHERE level_id = ?');
        $classmatesStmt->execute([$levelId]);
        $classmates = $classmatesStmt->fetchAll();
        $gradesStmt = $db->prepare('SELECT student_id, subject_id, type, value, status FROM grades WHERE student_id IN (SELECT id FROM students WHERE level_id = ?)');
        $gradesStmt->execute([$levelId]);
        $grades = $gradesStmt->fetchAll();

        $reportOf = function ($sId) use ($subjects, $grades, $rattrapageOpen, $units) {
            $sGrd = array_values(array_filter($grades, fn($g) => $g['student_id'] === $sId));
            return Calculations::buildReport($subjects, $sGrd, $rattrapageOpen, $units);
        };

        $report = $reportOf($studentId);
        $classReports = array_map(fn($cm) => $reportOf($cm['id']), $classmates);

        $lines = [];
        foreach ($report['lines'] as $i => $line) {
            $cmAvgs = [];
            foreach ($classReports as $cr) {
                if (isset($cr['lines'][$i]['average'])) {
                    $cmAvgs[] = $cr['lines'][$i]['average'];
                }
            }
            $lines[] = array_merge($line, [
                'classAverage'     => Calculations::mean($cmAvgs),
                'examOrRattrapage' => $line['rattrapage'] ?? $line['exam'],
            ]);
        }

        $report['lines'] = $lines;

        $bStmt = $db->prepare('SELECT * FROM bulletins WHERE student_id = ? AND semester = ?');
        $bStmt->execute([$studentId, $semester]);
        $rawB = $bStmt->fetch();
        $bulletin = null;
        if ($rawB) {
            $bulletin = [
                'id'               => $rawB['id'],
                'studentId'        => $rawB['student_id'],
                'semester'         => $rawB['semester'],
                'academicYear'     => $rawB['academic_year'],
                'average'          => $rawB['average'] !== null ? (float)$rawB['average'] : null,
                'mention'          => $rawB['mention'],
                'result'           => $rawB['result'],
                'rank'             => $rawB['rank'] !== null ? (int)$rawB['rank'] : null,
                'classRanked'      => $rawB['class_ranked'] !== null ? (int)$rawB['class_ranked'] : null,
                'classSize'        => $rawB['class_size'] !== null ? (int)$rawB['class_size'] : null,
                'classAverage'     => $rawB['class_average'] !== null ? (float)$rawB['class_average'] : null,
                'totalCoefficient' => $rawB['total_coefficient'] !== null ? (float)$rawB['total_coefficient'] : null,
                'credits'          => is_string($rawB['credits']) ? json_decode($rawB['credits'], true) : $rawB['credits'],
                'units'            => is_string($rawB['units']) ? json_decode($rawB['units'], true) : $rawB['units'],
                'lines'            => is_string($rawB['lines']) ? json_decode($rawB['lines'], true) : $rawB['lines'],
                'retake'           => is_string($rawB['retake']) ? json_decode($rawB['retake'], true) : $rawB['retake'],
                'appreciation'     => $rawB['appreciation'],
                'generatedAt'      => $rawB['generated_at'],
                'generatedBy'      => $rawB['generated_by'],
            ];
        }

        Response::json([
            'student'   => [
                'id'         => $student['id'],
                'matricule'  => $student['matricule'],
                'firstName'  => $student['firstName'],
                'lastName'   => $student['lastName'],
                'birthDate'  => $student['birthDate'],
                'birthPlace' => $student['birthPlace'],
                'email'      => $student['email'],
                'phone'      => $student['phone'],
                'filiereId'  => $student['filiereId'],
                'levelId'    => $student['levelId'],
                'photo'      => $student['photo'],
            ],
            'className' => $className,
            'report'    => $report,
            'bulletin'  => $bulletin,
            'cc'        => Calculations::mean(array_column($lines, 'cc')),
            'exam'      => Calculations::mean(array_column($lines, 'examOrRattrapage')),
        ]);
    }
}

