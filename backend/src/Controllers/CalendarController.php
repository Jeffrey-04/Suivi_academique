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

        $rawAudience = $input['audience'] ?? [];
        if (!is_array($rawAudience)) {
            $rawAudience = $rawAudience ? [$rawAudience] : [];
        }
        $audience = array_values(array_intersect(['chef', 'enseignant', 'etudiant'], $rawAudience));
        if (empty($audience)) {
            $errors['audience'] = 'Choisissez au moins un destinataire.';
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
            'audience'    => $audience,
        ];
    }

    private static function notifyUsers(
        PDO $db,
        array $event,
        string $kind,
        string $authorId,
        string $todayStr
    ): int {
        $eventEndDate = $event['end'] ?? $event['start'];
        if ($eventEndDate < $todayStr) {
            return 0;
        }

        // Récupérer les utilisateurs actifs dont le rôle est dans l'audience
        $placeholders = implode(',', array_fill(0, count($event['audience']), '?'));
        $sql = "SELECT id, role, settings FROM users WHERE active = 1 AND id != ? AND role IN ($placeholders)";
        $params = array_merge([$authorId], $event['audience']);

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $users = $stmt->fetchAll();

        $nowStr = $todayStr . 'T' . date('H:i:s'); // jour de référence (simulé en démonstration) + heure réelle
        $notified = 0;

        $ins = $db->prepare('
            INSERT INTO notifications (id, user_id, event_id, kind, stage, message, `read`, created_at)
            VALUES (?, ?, ?, ?, NULL, ?, 0, ?)
        ');

        foreach ($users as $u) {
            $settings = !empty($u['settings']) ? (is_string($u['settings']) ? json_decode($u['settings'], true) : $u['settings']) : [];
            // Si announcements est explicitement false, on ne notifie pas
            if (isset($settings['announcements']) && $settings['announcements'] === false) {
                continue;
            }

            $ntfId = self::generateId('ntf', $db, 'notifications');
            $ins->execute([
                $ntfId,
                $u['id'],
                $event['id'],
                $kind,
                $event['title'],
                $nowStr
            ]);
            $notified++;
        }

        return $notified;
    }

    public function listEvents(array $params, array $body, array $query): void
    {
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $stmt = $db->query('
            SELECT id, type, title, start, end, start_time AS startTime, end_time AS endTime,
                   location, description, audience, created_by AS createdBy, created_at AS createdAt
            FROM events
            ORDER BY start ASC, start_time ASC
        ');
        $rows = $stmt->fetchAll();

        $from = $query['from'] ?? null;
        $to   = $query['to'] ?? null;
        $types = !empty($query['types']) ? explode(',', $query['types']) : null;

        $filtered = [];
        foreach ($rows as $r) {
            $aud = is_string($r['audience']) ? json_decode($r['audience'], true) : $r['audience'];
            if (!is_array($aud)) {
                $aud = [];
            }
            $r['audience'] = $aud;

            // Filtrage par audience selon rôle (le chef voit tout)
            if ($user['role'] !== 'chef' && !in_array($user['role'], $aud, true)) {
                continue;
            }

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
        $user = Auth::requireLogin();
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('
            SELECT id, type, title, start, end, start_time AS startTime, end_time AS endTime,
                   location, description, audience, created_by AS createdBy, created_at AS createdAt
            FROM events WHERE id = ?
        ');
        $stmt->execute([$id]);
        $event = $stmt->fetch();

        if (!$event) {
            Response::json(['message' => 'Événement introuvable.'], 404);
        }

        $aud = is_string($event['audience']) ? json_decode($event['audience'], true) : $event['audience'];
        if (!is_array($aud)) {
            $aud = [];
        }
        $event['audience'] = $aud;

        // Contrôle d'audience
        if ($user['role'] !== 'chef' && !in_array($user['role'], $aud, true)) {
            Response::json(['message' => 'Événement introuvable.'], 404);
        }

        Response::json($event);
    }

    public function rattrapageOpen(): void
    {
        Auth::requireLogin();
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
        $user = Auth::requireLogin();
        if ($user['role'] !== 'chef') {
            Response::validationError('Seul le chef de département peut créer un événement.');
        }

        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
        $db = Database::getConnection();

        $data = self::validateEvent($body, $config);
        $id = self::generateId('evt', $db, 'events');

        $stmt = $db->prepare('
            INSERT INTO events (id, type, title, start, end, start_time, end_time, location, description, audience, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            json_encode($data['audience']),
            $user['id'],
            $todayStr
        ]);

        $event = array_merge($data, [
            'id'        => $id,
            'createdBy' => $user['id'],
            'createdAt' => $todayStr,
        ]);

        $notified = 0;
        if (!empty($body['notify'])) {
            $notified = self::notifyUsers($db, $event, 'created', $user['id'], $todayStr);
        }

        Response::json(['event' => $event, 'notified' => $notified], 201);
    }

    public function updateEvent(array $params, array $body): void
    {
        $user = Auth::requireLogin();
        if ($user['role'] !== 'chef') {
            Response::validationError('Seul le chef de département peut modifier un événement.');
        }

        $id = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $todayStr = $config['simulated_today'] ?: date('Y-m-d');
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
                location = ?, description = ?, audience = ?
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
            json_encode($data['audience']),
            $id
        ]);

        $event = array_merge($data, [
            'id'        => $id,
            'createdBy' => $existing['created_by'],
            'createdAt' => $existing['created_at'],
        ]);

        $notified = 0;
        if (!empty($body['notify'])) {
            $notified = self::notifyUsers($db, $event, 'updated', $user['id'], $todayStr);
        }

        Response::json(['event' => $event, 'notified' => $notified]);
    }

    public function deleteEvent(array $params): void
    {
        $user = Auth::requireLogin();
        if ($user['role'] !== 'chef') {
            Response::validationError('Seul le chef de département peut supprimer un événement.');
        }

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
        $user = Auth::requireLogin();
        $db = Database::getConnection();
        $limit = !empty($query['limit']) ? (int)$query['limit'] : 5;

        $stmt = $db->prepare('
            SELECT n.id, n.user_id AS userId, n.event_id AS eventId, n.kind, n.stage, n.message, n.read, n.created_at AS createdAt,
                   e.id AS e_id, e.type AS e_type, e.title AS e_title, e.start AS e_start, e.end AS e_end,
                   e.start_time AS e_start_time, e.end_time AS e_end_time, e.location AS e_location,
                   e.description AS e_description, e.audience AS e_audience, e.created_by AS e_created_by, e.created_at AS e_created_at
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
                $aud = is_string($r['e_audience']) ? json_decode($r['e_audience'], true) : $r['e_audience'];
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
                    'audience'    => is_array($aud) ? $aud : [],
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
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND `read` = 0');
        $stmt->execute([$user['id']]);
        $count = (int)$stmt->fetchColumn();

        Response::json(['count' => $count]);
    }

    public function markRead(array $params): void
    {
        $user = Auth::requireLogin();
        $id = $params['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('UPDATE notifications SET `read` = 1 WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $user['id']]);

        Response::noContent();
    }

    public function markAllRead(): void
    {
        $user = Auth::requireLogin();
        $db = Database::getConnection();

        $stmt = $db->prepare('UPDATE notifications SET `read` = 1 WHERE user_id = ?');
        $stmt->execute([$user['id']]);

        Response::noContent();
    }
}

