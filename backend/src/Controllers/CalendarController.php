<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';

class CalendarController
{
    private static function generateId(string $prefix, PDO $db, string $table): string
    {
        return Ids::next($db, $prefix);
    }

    private static function academicYearBounds(string $academicYear): array
    {
        $first = (int)substr($academicYear, 0, 4);
        return [
            'from' => sprintf('%04d-09-01', $first),
            'to'   => sprintf('%04d-08-31', $first + 1),
        ];
    }

    private static function validateEvent(array $input, array $config): array
    {
        $errors = [];
        $validTypes = ['stage', 'cc', 'session_normale', 'rattrapage', 'reunion', 'autre'];
        $type = trim((string)($input['type'] ?? ''));
        if (!in_array($type, $validTypes, true)) {
            $errors['type'] = "Choisissez le type d'événement.";
        }

        $title = trim((string)($input['title'] ?? ''));
        if (mb_strlen($title) < 3) {
            $errors['title'] = 'Indiquez un titre (3 caractères minimum).';
        } elseif (mb_strlen($title) > 120) {
            $errors['title'] = 'Le titre ne doit pas dépasser 120 caractères.';
        }

        $bounds = self::academicYearBounds($config['academic_year']);
        $start = trim((string)($input['start'] ?? ''));
        $dateRegex = '/^\d{4}-\d{2}-\d{2}$/';

        if (!preg_match($dateRegex, $start) || strtotime($start) === false) {
            $errors['start'] = 'Indiquez la date de début.';
        } elseif ($start < $bounds['from'] || $start > $bounds['to']) {
            $dFrom = date('d/m/Y', strtotime($bounds['from']));
            $dTo   = date('d/m/Y', strtotime($bounds['to']));
            $errors['start'] = "La date doit être dans l'année universitaire {$config['academic_year']} ($dFrom – $dTo).";
        }

        $end = trim((string)($input['end'] ?? '')) ?: null;
        if ($end) {
            if (!preg_match($dateRegex, $end) || strtotime($end) === false) {
                $errors['end'] = 'Date de fin invalide.';
            } elseif (empty($errors['start']) && $end < $start) {
                $errors['end'] = 'La date de fin doit être postérieure ou égale à la date de début.';
            } elseif ($end > $bounds['to']) {
                $dTo = date('d/m/Y', strtotime($bounds['to']));
                $errors['end'] = "La date de fin dépasse l'année universitaire ($dTo).";
            }
        }
        if ($end === $start) {
            $end = null;
        }

        $startTime = trim((string)($input['startTime'] ?? '')) ?: null;
        $endTime   = trim((string)($input['endTime'] ?? '')) ?: null;
        $timeRegex = '/^([01]\d|2[0-3]):[0-5]\d$/';

        if ($startTime && !preg_match($timeRegex, $startTime)) {
            $errors['startTime'] = 'Heure de début invalide (HH:MM).';
        }
        if ($endTime && !preg_match($timeRegex, $endTime)) {
            $errors['endTime'] = 'Heure de fin invalide (HH:MM).';
        }

        if ($end && ($startTime || $endTime)) {
            $errors['startTime'] = "Les horaires ne s'appliquent qu'à un événement d'un seul jour.";
        } elseif (empty($errors['startTime']) && empty($errors['endTime'])) {
            if ($endTime && !$startTime) {
                $errors['startTime'] = "Indiquez l'heure de début.";
            } elseif ($startTime && $endTime && $endTime <= $startTime) {
                $errors['endTime'] = "L'heure de fin doit être postérieure à l'heure de début.";
            }
        }
        if ($end) {
            $startTime = null;
            $endTime = null;
        }

        $location = trim((string)($input['location'] ?? ''));
        if (mb_strlen($location) > 80) {
            $errors['location'] = 'Le lieu ne doit pas dépasser 80 caractères.';
        }

        $description = trim((string)($input['description'] ?? ''));
        if (mb_strlen($description) > 500) {
            $errors['description'] = 'La description ne doit pas dépasser 500 caractères.';
        }

        if (!empty($errors)) {
            Response::validationError('Corrigez les champs signalés.', $errors);
        }

        return [
            'type'        => $type,
            'title'       => $title,
            'start'       => $start,
            'end'         => $end,
            'startTime'   => $startTime,
            'endTime'     => $endTime,
            'location'    => $location ?: null,
            'description' => $description ?: null,
        ];
    }

    public function listEvents(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $stmt = $db->query('
            SELECT id, type, title, start, end, start_time AS startTime, end_time AS endTime,
                   location, description, created_by AS createdBy, created_at AS createdAt
            FROM events
            ORDER BY start ASC, start_time ASC
        ');
        $rows = $stmt->fetchAll();

        $from = $query['from'] ?? null;
        $to   = $query['to'] ?? null;
        $types = !empty($query['types']) ? explode(',', $query['types']) : null;

        $filtered = [];
        foreach ($rows as $r) {
            // Période : (end ?? start) >= from ET start <= to
            $eventEnd = $r['end'] ?? $r['start'];
            if ($from && $eventEnd < $from) {
                continue;
            }
            if ($to && $r['start'] > $to) {
                continue;
            }

            // Types
            if ($types && !in_array($r['type'], $types, true)) {
                continue;
            }

            $filtered[] = $r;
        }

        Response::json($filtered);
    }

    public function getEvent(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('
            SELECT id, type, title, start, end, start_time AS startTime, end_time AS endTime,
                   location, description, created_by AS createdBy, created_at AS createdAt
            FROM events WHERE id = ?
        ');
        $stmt->execute([$id]);
        $event = $stmt->fetch();

        if (!$event) {
            Response::json(['message' => 'Événement introuvable.'], 404);
        }

        Response::json($event);
    }

    public function rattrapageOpen(): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT COUNT(*) FROM events WHERE type = "rattrapage" AND start > ?');
        $stmt->execute([$todayStr]);
        $open = (int)$stmt->fetchColumn() > 0;

        Response::json(['open' => $open]);
    }

    public function createEvent(array $params, array $body): void
    {
        $user = Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $data = self::validateEvent($body, $config);
        $id = self::generateId('evt', $db, 'events');

        $stmt = $db->prepare('
            INSERT INTO events (id, type, title, start, end, start_time, end_time, location, description, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $id,
            $data['type'],
            $data['title'],
            $data['start'],
            $data['end'],
            $data['startTime'],
            $data['endTime'],
            $data['location'],
            $data['description'],
            $user['id'],
            $todayStr
        ]);

        Response::json(array_merge($data, [
            'id'        => $id,
            'createdBy' => $user['id'],
            'createdAt' => $todayStr,
        ]), 201);
    }

    public function updateEvent(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $checkStmt = $db->prepare('SELECT * FROM events WHERE id = ?');
        $checkStmt->execute([$id]);
        $existing = $checkStmt->fetch();
        if (!$existing) {
            Response::validationError('Événement introuvable.');
        }

        $data = self::validateEvent($body, $config);

        $stmt = $db->prepare('
            UPDATE events
            SET type = ?, title = ?, start = ?, end = ?, start_time = ?, end_time = ?,
                location = ?, description = ?
            WHERE id = ?
        ');
        $stmt->execute([
            $data['type'],
            $data['title'],
            $data['start'],
            $data['end'],
            $data['startTime'],
            $data['endTime'],
            $data['location'],
            $data['description'],
            $id
        ]);

        Response::json(array_merge($data, [
            'id'        => $id,
            'createdBy' => $existing['created_by'],
            'createdAt' => $existing['created_at'],
        ]));
    }

    public function deleteEvent(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT id FROM events WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            Response::validationError('Événement introuvable.');
        }

        $db->beginTransaction();
        try {
            $db->prepare('DELETE FROM notifications WHERE event_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM events WHERE id = ?')->execute([$id]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            Response::serverError($e, "La suppression de l'événement a échoué");
        }

        Response::noContent();
    }

    public function notificationCount(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT COUNT(*) FROM notifications WHERE event_id = ?');
        $stmt->execute([$id]);
        $count = (int)$stmt->fetchColumn();

        Response::json(['count' => $count]);
    }

    public function listNotifications(array $params, array $body, array $query): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();
        $limit = !empty($query['limit']) ? (int)$query['limit'] : 5;

        $stmt = $db->prepare('
            SELECT n.id, n.user_id AS userId, n.event_id AS eventId, n.kind, n.stage, n.message, n.read, n.created_at AS createdAt,
                   e.id AS e_id, e.type AS e_type, e.title AS e_title, e.start AS e_start, e.end AS e_end,
                   e.start_time AS e_start_time, e.end_time AS e_end_time, e.location AS e_location,
                   e.description AS e_description, e.created_by AS e_created_by, e.created_at AS e_created_at
            FROM notifications n
            LEFT JOIN events e ON e.id = n.event_id
            WHERE n.user_id = ?
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT ?
        ');
        $stmt->bindValue(1, $user['id'], PDO::PARAM_STR);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();

        $notifications = [];
        foreach ($rows as $r) {
            $event = null;
            if (!empty($r['e_id'])) {
                $event = [
                    'id'          => $r['e_id'],
                    'type'        => $r['e_type'],
                    'title'       => $r['e_title'],
                    'start'       => $r['e_start'],
                    'end'         => $r['e_end'],
                    'startTime'   => $r['e_start_time'],
                    'endTime'     => $r['e_end_time'],
                    'location'    => $r['e_location'],
                    'description' => $r['e_description'],
                    'createdBy'   => $r['e_created_by'],
                    'createdAt'   => $r['e_created_at'],
                ];
            }

            $notifications[] = [
                'id'        => $r['id'],
                'userId'    => $r['userId'],
                'eventId'   => $r['eventId'],
                'kind'      => $r['kind'],
                'stage'     => $r['stage'] !== null ? (int)$r['stage'] : null,
                'message'   => $r['message'],
                'read'      => (bool)$r['read'],
                'createdAt' => date('Y-m-d\TH:i:s', strtotime($r['createdAt'])),
                'event'     => $event,
            ];
        }

        Response::json($notifications);
    }

    public function unreadCount(): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND `read` = 0');
        $stmt->execute([$user['id']]);
        $count = (int)$stmt->fetchColumn();

        Response::json(['count' => $count]);
    }

    public function markRead(array $params): void
    {
        $user = Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('UPDATE notifications SET `read` = 1 WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $user['id']]);

        Response::noContent();
    }

    public function markAllRead(): void
    {
        $user = Auth::requireRole('chef');
        $db = Database::getConnection();

        $stmt = $db->prepare('UPDATE notifications SET `read` = 1 WHERE user_id = ?');
        $stmt->execute([$user['id']]);

        Response::noContent();
    }
}

