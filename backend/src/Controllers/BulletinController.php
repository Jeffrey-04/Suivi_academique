<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';
require_once __DIR__ . '/../Calculations.php';

class BulletinController
{
    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    private static function isRattrapageOpen(PDO $db, string $todayStr): bool
    {
        $stmt = $db->prepare("SELECT COUNT(*) FROM events WHERE type = 'rattrapage' AND start > ?");
        $stmt->execute([$todayStr]);
        return (int)$stmt->fetchColumn() > 0;
    }

    private static function loadContext(PDO $db, string $semester, string $todayStr): array
    {
        $rattrapageOpen = self::isRattrapageOpen($db, $todayStr);

        // Students
        $students = $db->query('
            SELECT id, matricule, first_name AS firstName, last_name AS lastName, birth_date AS birthDate, birth_place AS birthPlace, email, phone, filiere_id AS filiereId, level_id AS levelId, photo
            FROM students ORDER BY last_name ASC, first_name ASC
        ')->fetchAll();

        // Subjects for semester
        $subStmt = $db->prepare('
            SELECT id, code, name, coefficient, planned_hours AS plannedHours, level_id AS levelId, semester, teacher_id AS teacherId, unit_id AS unitId
            FROM subjects WHERE semester = ?
        ');
        $subStmt->execute([$semester]);
        $subjects = $subStmt->fetchAll();
        foreach ($subjects as $idx => $s) {
            $subjects[$idx]['coefficient'] = (float)$s['coefficient'];
            $subjects[$idx]['plannedHours'] = (int)$s['plannedHours'];
        }

        // Grades
        $grades = $db->query('
            SELECT id, student_id AS studentId, subject_id AS subjectId, type, value, status, entered_by AS enteredBy, entered_at AS enteredAt, validated_by AS validatedBy, validated_at AS validatedAt
            FROM grades
        ')->fetchAll();
        foreach ($grades as $idx => $g) {
            $grades[$idx]['value'] = (float)$g['value'];
        }

        // Bulletins
        $bStmt = $db->prepare('SELECT * FROM bulletins WHERE semester = ?');
        $bStmt->execute([$semester]);
        $rawBulletins = $bStmt->fetchAll();
        $bulletins = [];
        foreach ($rawBulletins as $b) {
            $bulletins[] = self::formatBulletin($b);
        }

        // Levels & Filieres
        $levels = $db->query('SELECT id, name, label, filiere_id AS filiereId FROM levels')->fetchAll();
        $filieres = $db->query('SELECT id, code, name FROM filieres')->fetchAll();
        $units = $db->prepare('SELECT id, code, name, type, level_id AS levelId, semester FROM units WHERE semester = ?');
        $units->execute([$semester]);
        $allUnits = $units->fetchAll();

        // Chief
        $chiefStmt = $db->query('SELECT first_name AS firstName, last_name AS lastName FROM users WHERE role = "chef" LIMIT 1');
        $chief = $chiefStmt->fetch() ?: null;

        return [
            'students'       => $students,
            'subjects'       => $subjects,
            'grades'         => $grades,
            'bulletins'      => $bulletins,
            'levels'         => $levels,
            'filieres'       => $filieres,
            'units'          => $allUnits,
            'chief'          => $chief,
            'rattrapageOpen' => $rattrapageOpen,
            'semester'       => $semester,
        ];
    }

    private static function formatBulletin(array $b): array
    {
        return [
            'id'               => $b['id'],
            'studentId'        => $b['student_id'],
            'semester'         => $b['semester'],
            'academicYear'     => $b['academic_year'],
            'average'          => $b['average'] !== null ? (float)$b['average'] : null,
            'mention'          => $b['mention'],
            'result'           => $b['result'],
            'rank'             => $b['rank'] !== null ? (int)$b['rank'] : null,
            'classRanked'      => $b['class_ranked'] !== null ? (int)$b['class_ranked'] : null,
            'classSize'        => $b['class_size'] !== null ? (int)$b['class_size'] : null,
            'classAverage'     => $b['class_average'] !== null ? (float)$b['class_average'] : null,
            'totalCoefficient' => $b['total_coefficient'] !== null ? (float)$b['total_coefficient'] : null,
            'credits'          => is_string($b['credits']) ? json_decode($b['credits'], true) : $b['credits'],
            'units'            => is_string($b['units']) ? json_decode($b['units'], true) : $b['units'],
            'lines'            => is_string($b['lines']) ? json_decode($b['lines'], true) : $b['lines'],
            'retake'           => is_string($b['retake']) ? json_decode($b['retake'], true) : $b['retake'],
            'appreciation'     => $b['appreciation'],
            'generatedAt'      => $b['generated_at'],
            'generatedBy'      => $b['generated_by'],
        ];
    }

    private static function classmatesOf(array $ctx, string $levelId): array
    {
        $subjects = array_values(array_filter($ctx['subjects'], fn($s) => $s['levelId'] === $levelId));
        $classStudents = array_values(array_filter($ctx['students'], fn($s) => $s['levelId'] === $levelId));
        $classUnits = array_values(array_filter($ctx['units'], fn($u) => $u['levelId'] === $levelId));

        $result = [];
        foreach ($classStudents as $student) {
            $sGrades = array_values(array_filter($ctx['grades'], fn($g) => $g['studentId'] === $student['id']));
            $report = Calculations::buildReport($subjects, $sGrades, $ctx['rattrapageOpen'], $classUnits);
            $result[] = [
                'studentId' => $student['id'],
                'report'    => $report,
            ];
        }
        return $result;
    }

    private static function getOverviewRows(array $ctx): array
    {
        $byLevel = [];
        $rows = [];

        foreach ($ctx['students'] as $student) {
            $lvlId = $student['levelId'];
            if (!isset($byLevel[$lvlId])) {
                $byLevel[$lvlId] = self::classmatesOf($ctx, $lvlId);
            }
            $classmates = $byLevel[$lvlId];

            $report = null;
            foreach ($classmates as $c) {
                if ($c['studentId'] === $student['id']) {
                    $report = $c['report'];
                    break;
                }
            }

            $bulletin = null;
            foreach ($ctx['bulletins'] as $b) {
                if ($b['studentId'] === $student['id'] && $b['semester'] === $ctx['semester']) {
                    $bulletin = $b;
                    break;
                }
            }

            $live = (!empty($report['complete'])) ? Calculations::bulletinSnapshot($report, $classmates) : null;

            $status = 'incomplete';
            if ($bulletin) {
                $status = ($live && Calculations::sameResults($bulletin, $live)) ? 'generated' : 'outdated';
            } else {
                $status = (!empty($report['complete'])) ? 'ready' : 'incomplete';
            }

            $missing = [];
            foreach ($report['lines'] as $l) {
                if ($l['average'] === null) {
                    $missing[] = ['code' => $l['code'], 'name' => $l['name']];
                }
            }

            $rows[] = [
                'student'  => $student,
                'report'   => $report,
                'bulletin' => $bulletin,
                'status'   => $status,
                'live'     => $live,
                'missing'  => $missing,
            ];
        }

        return $rows;
    }

    private static function formatBulletinDocument(array $ctx, array $row, array $config): array
    {
        $level = null;
        foreach ($ctx['levels'] as $l) {
            if ($l['id'] === $row['student']['levelId']) {
                $level = $l;
                break;
            }
        }
        $filiere = null;
        if ($level) {
            foreach ($ctx['filieres'] as $f) {
                if ($f['id'] === $level['filiereId']) {
                    $filiere = $f;
                    break;
                }
            }
        }

        $b = $row['bulletin'];
        $isMaster = !empty($level['name']) && $level['name'][0] === 'M';

        return array_merge($b, [
            'number'      => strtoupper($b['id']),
            'student'     => $row['student'],
            'cls'         => [
                'levelName'  => $level['name'] ?? '',
                'levelLabel' => $level['label'] ?? '',
                'filiere'    => $filiere['name'] ?? '',
                'label'      => ($level['label'] ?? '') . ' · ' . ($filiere['name'] ?? ''),
                'cycle'      => $isMaster ? ['fr' => 'MASTER', 'en' => 'MASTER'] : ['fr' => 'LICENCE', 'en' => 'BACHELOR'],
            ],
            'institution' => $config['institution'],
            'department'  => $config['department'],
            'appName'     => $config['app_name'],
            'chief'       => $ctx['chief'] ? ['firstName' => $ctx['chief']['firstName'], 'lastName' => $ctx['chief']['lastName']] : null,
            'grading'     => [
                'cc'       => Calculations::WEIGHTS['CC'],
                'exam'     => Calculations::WEIGHTS['EXAMEN'],
                'passMark' => Calculations::PASS_MARK,
                'mentions' => Calculations::MENTIONS,
            ],
            'outdated'    => ($row['status'] === 'outdated'),
        ]);
    }

    public function listBulletins(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'etudiant');
        $db = Database::getConnection();

        $sql = 'SELECT * FROM bulletins WHERE 1=1';
        $bindings = [];

        if ($user['role'] === 'etudiant') {
            $sql .= ' AND student_id = ?';
            $bindings[] = $user['profileId'];
        } elseif (!empty($query['studentId'])) {
            $sql .= ' AND student_id = ?';
            $bindings[] = $query['studentId'];
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        $bulletins = array_map([self::class, 'formatBulletin'], $rows);
        Response::json($bulletins);
    }

    public function countBulletins(): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();
        $count = (int)$db->query('SELECT COUNT(*) FROM bulletins')->fetchColumn();
        Response::json(['count' => $count]);
    }

    public function overview(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $semester = $query['semester'] ?? $config['current_semester'];
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $ctx = self::loadContext($db, $semester, $todayStr);
        $rows = self::getOverviewRows($ctx);
        Response::json($rows);
    }

    public function studentReport(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'etudiant');
        $studentId = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $semester = $query['semester'] ?? $config['current_semester'];
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        if ($user['role'] === 'etudiant' && $user['profileId'] !== $studentId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $ctx = self::loadContext($db, $semester, $todayStr);
        $rows = self::getOverviewRows($ctx);

        $row = null;
        foreach ($rows as $r) {
            if ($r['student']['id'] === $studentId) {
                $row = $r;
                break;
            }
        }

        if (!$row) {
            Response::json(['message' => 'Étudiant introuvable.'], 404);
        }

        Response::json([
            'student'  => $row['student'],
            'report'   => $row['report'],
            'bulletin' => $row['bulletin'],
        ]);
    }

    public function studentBulletin(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'etudiant');
        $studentId = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $semester = $query['semester'] ?? $config['current_semester'];
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        if ($user['role'] === 'etudiant' && $user['profileId'] !== $studentId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $ctx = self::loadContext($db, $semester, $todayStr);
        $rows = self::getOverviewRows($ctx);

        $row = null;
        foreach ($rows as $r) {
            if ($r['student']['id'] === $studentId) {
                $row = $r;
                break;
            }
        }

        if (!$row) {
            Response::json(['message' => 'Étudiant introuvable.'], 404);
        }

        $level = null;
        foreach ($ctx['levels'] as $l) {
            if ($l['id'] === $row['student']['levelId']) {
                $level = $l;
                break;
            }
        }
        $filiere = null;
        if ($level) {
            foreach ($ctx['filieres'] as $f) {
                if ($f['id'] === $level['filiereId']) {
                    $filiere = $f;
                    break;
                }
            }
        }

        $document = null;
        if ($row['bulletin']) {
            $document = self::formatBulletinDocument($ctx, $row, $config);
        }

        Response::json([
            'student'  => $row['student'],
            'cls'      => [
                'levelName'  => $level['name'] ?? '',
                'levelLabel' => $level['label'] ?? '',
                'filiere'    => $filiere['name'] ?? '',
                'label'      => ($level['label'] ?? '') . ' · ' . ($filiere['name'] ?? ''),
            ],
            'status'   => $row['status'],
            'missing'  => $row['missing'],
            'report'   => $row['report'],
            'document' => $document,
        ]);
    }

    public function studentDocument(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'etudiant');
        $studentId = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $semester = $query['semester'] ?? $config['current_semester'];
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        if ($user['role'] === 'etudiant' && $user['profileId'] !== $studentId) {
            Response::json(['message' => 'Accès non autorisé.'], 403);
        }

        $ctx = self::loadContext($db, $semester, $todayStr);
        $rows = self::getOverviewRows($ctx);

        $row = null;
        foreach ($rows as $r) {
            if ($r['student']['id'] === $studentId) {
                $row = $r;
                break;
            }
        }

        if (!$row || !$row['bulletin']) {
            Response::json(['message' => 'Bulletin introuvable.'], 404);
        }

        $doc = self::formatBulletinDocument($ctx, $row, $config);
        Response::json($doc);
    }

    public function generate(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');

        $config = require __DIR__ . '/../../config/config.php';
        $semester = $body['semester'] ?? $config['current_semester'];
        $studentIds = $body['studentIds'] ?? null;
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $ctx = self::loadContext($db, $semester, $todayStr);
        $allRows = self::getOverviewRows($ctx);

        usort($allRows, fn($a, $b) => strcmp($a['student']['id'], $b['student']['id'])); // ids de bulletins attribués dans l'ordre des étudiants
        $rowsToProcess = [];
        if (!empty($studentIds) && is_array($studentIds)) {
            $rowsToProcess = array_values(array_filter($allRows, fn($r) => in_array($r['student']['id'], $studentIds, true)));
        } else {
            $rowsToProcess = array_values(array_filter($allRows, fn($r) => in_array($r['status'], ['ready', 'outdated'], true)));
        }

        $result = ['generated' => 0, 'regenerated' => 0, 'skipped' => []];
        $db->beginTransaction();

        try {
            foreach ($rowsToProcess as $row) {
                if (!$row['live']) {
                    $codes = array_map(fn($m) => $m['code'], $row['missing']);
                    $result['skipped'][] = [
                        'student' => $row['student'],
                        'reason'  => 'il manque la moyenne de ' . implode(', ', $codes),
                    ];
                    continue;
                }

                if ($row['status'] === 'generated') {
                    $result['skipped'][] = [
                        'student' => $row['student'],
                        'reason'  => 'bulletin déjà à jour',
                    ];
                    continue;
                }

                $live = $row['live'];
                $sId = $row['student']['id'];
                $bulletinId = $row['bulletin']['id'] ?? self::generateId('blt', $db, 'bulletins');

                $stmt = $db->prepare('
                    INSERT INTO bulletins (
                        id, student_id, semester, academic_year, average, mention, result,
                        `rank`, class_ranked, class_size, class_average, total_coefficient,
                        credits, units, `lines`, retake, appreciation, generated_at, generated_by
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?
                    )
                    ON DUPLICATE KEY UPDATE
                        average = VALUES(average),
                        mention = VALUES(mention),
                        result = VALUES(result),
                        `rank` = VALUES(`rank`),
                        class_ranked = VALUES(class_ranked),
                        class_size = VALUES(class_size),
                        class_average = VALUES(class_average),
                        total_coefficient = VALUES(total_coefficient),
                        credits = VALUES(credits),
                        units = VALUES(units),
                        `lines` = VALUES(`lines`),
                        retake = VALUES(retake),
                        appreciation = VALUES(appreciation),
                        generated_at = VALUES(generated_at),
                        generated_by = VALUES(generated_by)
                ');

                $stmt->execute([
                    $bulletinId,
                    $sId,
                    $semester,
                    $config['academic_year'],
                    $live['average'],
                    $live['mention'],
                    $live['result'],
                    $live['rank'],
                    $live['classRanked'],
                    $live['classSize'],
                    $live['classAverage'],
                    $live['totalCoefficient'],
                    json_encode($live['credits']),
                    json_encode($live['units']),
                    json_encode($live['lines']),
                    json_encode($live['retake']),
                    $live['appreciation'],
                    $todayStr,
                    $user['id']
                ]);

                if (!empty($row['bulletin'])) {
                    $result['regenerated']++;
                } else {
                    $result['generated']++;
                }
            }

            if ($result['generated'] === 0 && $result['regenerated'] === 0 && !empty($studentIds) && !empty($result['skipped'])) {
                $db->rollBack();
                Response::validationError('Génération impossible : ' . $result['skipped'][0]['reason'] . '.');
            }

            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, 'La génération des bulletins a échoué');
        }

        Response::json($result);
    }
}

