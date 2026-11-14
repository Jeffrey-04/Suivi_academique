<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';
require_once __DIR__ . '/../Calculations.php';

class PresenceController
{
    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    public function location(): void
    {
        Auth::requireLogin();
        $config = require __DIR__ . '/../../config/config.php';
        Response::json($config['institution']['location']);
    }

    public function listCheckins(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef', 'enseignant');
        $db = Database::getConnection();

        $sql = '
            SELECT c.id, c.teacher_id AS teacherId, c.subject_id AS subjectId, c.date, c.time, c.distance, c.accuracy,
                   s.id AS s_id, s.code AS s_code, s.name AS s_name, s.coefficient AS s_coefficient, s.planned_hours AS s_planned_hours,
                   s.level_id AS s_level_id, s.semester AS s_semester, s.teacher_id AS s_teacher_id, s.unit_id AS s_unit_id
            FROM checkins c
            LEFT JOIN subjects s ON s.id = c.subject_id
            WHERE 1=1
        ';
        $bindings = [];

        if ($user['role'] === 'enseignant') {
            $sql .= ' AND c.teacher_id = ?';
            $bindings[] = $user['profileId'];
        } elseif (!empty($query['teacherId'])) {
            $sql .= ' AND c.teacher_id = ?';
            $bindings[] = $query['teacherId'];
        }

        if (!empty($query['from'])) {
            $sql .= ' AND c.date >= ?';
            $bindings[] = $query['from'];
        }
        if (!empty($query['to'])) {
            $sql .= ' AND c.date <= ?';
            $bindings[] = $query['to'];
        }

        $sql .= ' ORDER BY c.date DESC, c.time DESC';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        $result = [];
        foreach ($rows as $r) {
            $subject = null;
            if (!empty($r['s_id'])) {
                $subject = [
                    'id'           => $r['s_id'],
                    'code'         => $r['s_code'],
                    'name'         => $r['s_name'],
                    'coefficient'  => (float)$r['s_coefficient'],
                    'plannedHours' => (int)$r['s_planned_hours'],
                    'levelId'      => $r['s_level_id'],
                    'semester'     => $r['s_semester'],
                    'teacherId'    => $r['s_teacher_id'],
                    'unitId'       => $r['s_unit_id'],
                ];
            }

            $result[] = [
                'id'        => $r['id'],
                'teacherId' => $r['teacherId'],
                'subjectId' => $r['subjectId'],
                'date'      => $r['date'],
                'time'      => $r['time'],
                'distance'  => (int)$r['distance'],
                'accuracy'  => (int)$r['accuracy'],
                'subject'   => $subject,
            ];
        }

        Response::json($result);
    }

    public function checkIn(array $params, array $body): void
    {
        $user = Auth::requireRole('enseignant');
        if ($user['role'] !== 'enseignant') {
            Response::validationError("Seul l'enseignant peut marquer sa présence.");
        }

        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $subjectId = (string)($body['subjectId'] ?? '');
        $lat = $body['lat'] ?? null;
        $lng = $body['lng'] ?? null;
        $accuracy = $body['accuracy'] ?? null;

        $subStmt = $db->prepare('SELECT id, teacher_id FROM subjects WHERE id = ?');
        $subStmt->execute([$subjectId]);
        $subject = $subStmt->fetch();

        if (!$subject) {
            Response::validationError('Choisissez la matière concernée.', ['subjectId' => 'Choisissez la matière concernée.']);
        }
        if ($subject['teacher_id'] !== $user['profileId']) {
            Response::validationError("Cette matière ne vous est pas attribuée.", ['subjectId' => "Cette matière ne vous est pas attribuée."]);
        }

        $chkStmt = $db->prepare('SELECT time FROM checkins WHERE teacher_id = ? AND subject_id = ? AND date = ?');
        $chkStmt->execute([$user['profileId'], $subjectId, $todayStr]);
        $already = $chkStmt->fetch();
        if ($already) {
            $t = $already['time'];
            Response::validationError(
                "Présence déjà marquée aujourd'hui à $t pour cette matière.",
                ['subjectId' => "Déjà marquée à $t."]
            );
        }

        if (
            !is_numeric($lat) || !is_numeric($lng) || !is_numeric($accuracy) ||
            $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180 || $accuracy < 0
        ) {
            Response::validationError('Position invalide : réessayez la localisation.');
        }

        $accuracyNum = (float)$accuracy;
        $maxAccuracy = (int)$config['checkin_max_accuracy'];
        if ($accuracyNum > $maxAccuracy) {
            $roundedAcc = round($accuracyNum);
            Response::validationError("Précision insuffisante (±{$roundedAcc} m, {$maxAccuracy} m maximum). Rapprochez-vous d'une fenêtre ou réessayez à l'extérieur.");
        }

        $loc = $config['institution']['location'];
        $distance = Calculations::haversineDistance((float)$lat, (float)$lng, (float)$loc['lat'], (float)$loc['lng']);
        $radiusMeters = (int)$loc['radiusMeters'];

        if ($distance > $radiusMeters) {
            $formattedDist = Calculations::formatDistance($distance);
            Response::validationError("Vous êtes à {$formattedDist} de {$loc['name']} (rayon autorisé : {$radiusMeters} m). Rendez-vous sur le campus pour marquer votre présence.");
        }

        $id = self::generateId('chk', $db, 'checkins');
        $currentTime = date('H:i');

        $stmt = $db->prepare('
            INSERT INTO checkins (id, teacher_id, subject_id, date, time, distance, accuracy)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $id,
            $user['profileId'],
            $subjectId,
            $todayStr,
            $currentTime,
            $distance,
            round($accuracyNum)
        ]);

        Response::json([
            'id'        => $id,
            'teacherId' => $user['profileId'],
            'subjectId' => $subjectId,
            'date'      => $todayStr,
            'time'      => $currentTime,
            'distance'  => $distance,
            'accuracy'  => (int)round($accuracyNum),
        ], 201);
    }
}

