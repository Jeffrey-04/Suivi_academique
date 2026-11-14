<?php
declare(strict_types=1);

// Vérification en ligne de commande des valeurs de référence : php backend/tests/reference-check.php
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Auth.php';
require_once __DIR__ . '/../src/Calculations.php';
require_once __DIR__ . '/../src/Controllers/BulletinController.php';
require_once __DIR__ . '/../src/Controllers/GradeController.php';
require_once __DIR__ . '/../src/Controllers/SessionController.php';
require_once __DIR__ . '/../src/Controllers/CalendarController.php';
require_once __DIR__ . '/../src/Controllers/StatsController.php';

$config = require __DIR__ . '/../config/config.php';
$db = Database::getConnection();
$todayStr = $config['simulated_today'] ?: '2027-01-25';

$testsPassed = 0;
$testsFailed = 0;

function assertVal(string $name, $actual, $expected) {
    global $testsPassed, $testsFailed;
    if ($actual === $expected) {
        echo "  [PASS] $name\n";
        $testsPassed++;
    } else {
        echo "  [FAIL] $name: attendu " . json_encode($expected) . ", obtenu " . json_encode($actual) . "\n";
        $testsFailed++;
    }
}

echo "=== VÉRIFICATION DES VALEURS DE RÉFÉRENCE (contrat-api.md §8.2) ===\n\n";

// 1. Contrôles sur les notes
echo "1. Notes :\n";
$grades = $db->query('SELECT type, value, status FROM grades')->fetchAll();
$valGrades = array_filter($grades, fn($g) => $g['status'] === 'validee');
$draftGrades = array_filter($grades, fn($g) => $g['status'] === 'brouillon');
assertVal("Nombre de notes validées", count($valGrades), 510);
assertVal("Nombre de brouillons", count($draftGrades), 12);

$ccVal = array_column(array_filter($valGrades, fn($g) => $g['type'] === 'CC'), 'value');
$examVal = array_column(array_filter($valGrades, fn($g) => $g['type'] === 'EXAMEN'), 'value');
assertVal("Moyenne CC validée", Calculations::mean($ccVal), 10.96);
assertVal("Moyenne Examen validée", Calculations::mean($examVal), 10.77);

// 2. Étudiant stu-018 (Ulrich Foning, M1 GL)
echo "\n2. Étudiant stu-018 (Ulrich Foning, M1 GL) :\n";
$m1Subjects = $db->query("SELECT id, code, name, coefficient, planned_hours, level_id, semester, unit_id FROM subjects WHERE level_id = 'lvl-gl-m1' AND semester = 'S1'")->fetchAll();
$uGrades = $db->query("SELECT id, student_id, subject_id, type, value, status FROM grades WHERE student_id = 'stu-018'")->fetchAll();
$uUnits = $db->query("SELECT id, code, name, type, level_id, semester FROM units WHERE level_id = 'lvl-gl-m1' AND semester = 'S1'")->fetchAll();

$uReport = Calculations::buildReport($m1Subjects, $uGrades, true, $uUnits);
assertVal("Moyenne générale S1", $uReport['average'], 10.43);
assertVal("Résultat final", $uReport['result'], 'Admis');
assertVal("Mention", $uReport['mention'], 'Passable');
assertVal("Crédits totaux", $uReport['credits']['total'], 16.0);
assertVal("Crédits acquis", $uReport['credits']['acquired'], 16.0);

$averagesByCode = [];
foreach ($uReport['lines'] as $l) {
    $averagesByCode[$l['code']] = $l['average'];
}
assertVal("Moyenne GL401", $averagesByCode['GL401'] ?? null, 10.30);
assertVal("Moyenne GL402", $averagesByCode['GL402'] ?? null, 10.68);
assertVal("Moyenne GL403", $averagesByCode['GL403'] ?? null, 11.93);
assertVal("Moyenne GL404", $averagesByCode['GL404'] ?? null, 9.63);
assertVal("Moyenne GL405", $averagesByCode['GL405'] ?? null, 9.65);

// Bulletin blt-007
$bStmt = $db->query("SELECT * FROM bulletins WHERE id = 'blt-007'");
$blt007 = $bStmt->fetch();
assertVal("Bulletin blt-007 rang", (int)$blt007['rank'], 4);
assertVal("Bulletin blt-007 classRanked", (int)$blt007['class_ranked'], 4);
assertVal("Bulletin blt-007 classSize", (int)$blt007['class_size'], 6);
assertVal("Bulletin blt-007 classAverage", (float)$blt007['class_average'], 12.34);

// 3. États des bulletins (54 étudiants, S1)
echo "\n3. États des bulletins et résultats département :\n";
$allStudents = $db->query("SELECT id, level_id FROM students")->fetchAll();
$allSubjectsS1 = $db->query("SELECT id, code, name, coefficient, level_id, semester, unit_id FROM subjects WHERE semester = 'S1'")->fetchAll();
$allGrades = $db->query("SELECT id, student_id, subject_id, type, value, status FROM grades")->fetchAll();
$allBulletins = $db->query("SELECT * FROM bulletins WHERE semester = 'S1'")->fetchAll();
$allUnitsS1 = $db->query("SELECT id, code, name, type, level_id, semester FROM units WHERE semester = 'S1'")->fetchAll();

$byLvl = [];
$statusCounts = ['generated' => 0, 'ready' => 0, 'incomplete' => 0, 'outdated' => 0];
$deptCounts = ['Admis' => 0, 'Rattrapage' => 0, 'Ajourné' => 0, 'Incomplet' => 0];

foreach ($allStudents as $st) {
    $lvl = $st['level_id'];
    if (!isset($byLvl[$lvl])) {
        $subs = array_values(array_filter($allSubjectsS1, fn($s) => $s['level_id'] === $lvl));
        $units = array_values(array_filter($allUnitsS1, fn($u) => $u['level_id'] === $lvl));
        $classmates = array_values(array_filter($allStudents, fn($s) => $s['level_id'] === $lvl));

        $cms = [];
        foreach ($classmates as $cm) {
            $grds = array_values(array_filter($allGrades, fn($g) => $g['student_id'] === $cm['id']));
            $cms[] = [
                'studentId' => $cm['id'],
                'report'    => Calculations::buildReport($subs, $grds, true, $units),
            ];
        }
        $byLvl[$lvl] = $cms;
    }

    $rep = null;
    foreach ($byLvl[$lvl] as $c) {
        if ($c['studentId'] === $st['id']) {
            $rep = $c['report'];
            break;
        }
    }

    $deptCounts[$rep['result']]++;

    $b = null;
    foreach ($allBulletins as $bl) {
        if ($bl['student_id'] === $st['id']) {
            $b = $bl;
            break;
        }
    }

    $live = (!empty($rep['complete'])) ? Calculations::bulletinSnapshot($rep, $byLvl[$lvl]) : null;

    if ($b) {
        $formattedB = [
            'average'     => $b['average'] !== null ? (float)$b['average'] : null,
            'rank'        => $b['rank'] !== null ? (int)$b['rank'] : null,
            'classRanked' => $b['class_ranked'] !== null ? (int)$b['class_ranked'] : null,
            'credits'     => is_string($b['credits']) ? json_decode($b['credits'], true) : $b['credits'],
            'units'       => is_string($b['units']) ? json_decode($b['units'], true) : $b['units'],
            'lines'       => is_string($b['lines']) ? json_decode($b['lines'], true) : $b['lines'],
        ];
        $stt = ($live && Calculations::sameResults($formattedB, $live)) ? 'generated' : 'outdated';
    } else {
        $stt = (!empty($rep['complete'])) ? 'ready' : 'incomplete';
    }
    $statusCounts[$stt]++;
}

assertVal("Bulletins générés", $statusCounts['generated'], 19);
assertVal("Bulletins prêts", $statusCounts['ready'], 10);
assertVal("Bulletins incomplets", $statusCounts['incomplete'], 25);
assertVal("Bulletins à régénérer", $statusCounts['outdated'], 0);

assertVal("Résultats Admis", $deptCounts['Admis'], 17);
assertVal("Résultats Rattrapage", $deptCounts['Rattrapage'], 12);
assertVal("Résultats Ajourné", $deptCounts['Ajourné'], 0);
assertVal("Résultats Incomplet", $deptCounts['Incomplet'], 25);
assertVal("pendingBulletins", $statusCounts['ready'] + $statusCounts['outdated'], 10);

// 4. Enseignant tea-005 (Hervé Kamga)
echo "\n4. Enseignant tea-005 (Hervé Kamga) :\n";
$tea005 = $db->query("SELECT id, contract_hours FROM teachers WHERE id = 'tea-005'")->fetch();
$allSubs = $db->query("SELECT id, teacher_id, planned_hours FROM subjects")->fetchAll();
$allSessions = $db->query("SELECT id, teacher_id, date, start_time, end_time, status FROM sessions")->fetchAll();
$h005 = Calculations::hoursSummary($tea005, $allSubs, $allSessions, 'S1-2026-2027');

assertVal("tea-005 planned", $h005['planned'], 225);
assertVal("tea-005 done", $h005['done'], 221.0);
assertVal("tea-005 contract", $h005['contract'], 180);
assertVal("tea-005 overtime", $h005['overtime'], 41.0);
assertVal("tea-005 missing", $h005['missing'], 4.0);

// 5. Toutes les séances
echo "\n5. Séances globales :\n";
$totalSessions = count($allSessions);
$presentSessions = array_filter($allSessions, fn($s) => $s['status'] === 'present');
$absentSessions = array_filter($allSessions, fn($s) => $s['status'] === 'absent');
$rate = Calculations::presenceRate($allSessions);

$doneHours = 0.0;
$schedHours = 0.0;
foreach ($allSessions as $s) {
    $dur = Calculations::sessionHours($s);
    $schedHours += $dur;
    if ($s['status'] === 'present') $doneHours += $dur;
}

assertVal("Total séances", $totalSessions, 870);
assertVal("Séances présentes", count($presentSessions), 828);
assertVal("Séances absentes", count($absentSessions), 42);
assertVal("Taux de présence", $rate, 95.2);
assertVal("Heures réalisées", (int)$doneHours, 1980);
assertVal("Heures programmées", (int)$schedHours, 2085);

// 6. Événements et rattrapage
echo "\n6. Événements et rattrapage :\n";
$events = $db->query("SELECT * FROM events")->fetchAll();
assertVal("Total événements", count($events), 15);
$rattrapageOpen = (int)$db->query("SELECT COUNT(*) FROM events WHERE type = 'rattrapage' AND start > '2027-01-25'")->fetchColumn() > 0;
assertVal("Rattrapage ouvert au 25/01/2027", $rattrapageOpen, true);

echo "\n=======================================================\n";
echo "RÉSULTAT DU TEST : $testsPassed PASSÉS, $testsFailed ÉCHOUÉS\n";
echo "=======================================================\n";

if ($testsFailed > 0) {
    exit(1);
}

