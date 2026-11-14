<?php
/**
 * Tâche planifiée (cron quotidien) pour l'envoi des rappels automatiques d'événements.
 * Peut être lancée par CLI : php reminders.php
 * ou appelée via URL sécurisée ou cron job hPanel/cPanel.
 */

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/Database.php';

function syncReminders(): int
{
    $config = require __DIR__ . '/../config/config.php';
    $todayStr = $config['simulated_today'] ?: date('Y-m-d');
    $db = Database::getConnection();

    $users = $db->query('SELECT id, role, settings FROM users WHERE active = 1')->fetchAll();
    $eventsStmt = $db->prepare('SELECT id, title, start, audience FROM events WHERE start >= ?');
    $eventsStmt->execute([$todayStr]);
    $events = $eventsStmt->fetchAll();
    $notifications = $db->query('SELECT id, user_id, event_id, kind, stage, created_at FROM notifications')->fetchAll();

    $stmtMax = $db->query("SELECT id FROM notifications WHERE id LIKE 'ntf-%'");
    $ids = $stmtMax->fetchAll(PDO::FETCH_COLUMN);
    $maxSeq = 0;
    foreach ($ids as $id) {
        if (preg_match('/^ntf-0*(\d+)$/', $id, $m)) {
            $maxSeq = max($maxSeq, (int)$m[1]);
        }
    }

    $ins = $db->prepare('
        INSERT INTO notifications (id, user_id, event_id, kind, stage, message, `read`, created_at)
        VALUES (?, ?, ?, "reminder", ?, ?, 0, ?)
    ');

    $createdCount = 0;

    foreach ($events as $event) {
        $aud = is_string($event['audience']) ? json_decode($event['audience'], true) : $event['audience'];
        if (!is_array($aud)) {
            continue;
        }

        $eventStart = $event['start'];
        $leftDays = (int)round((strtotime($eventStart) - strtotime($todayStr)) / 86400);

        foreach ($users as $user) {
            if (!in_array($user['role'], $aud, true)) {
                continue;
            }

            $userSettings = !empty($user['settings']) ? (is_string($user['settings']) ? json_decode($user['settings'], true) : $user['settings']) : [];
            $reminderStages = $userSettings['reminders'] ?? $config['reminder_days'] ?? [7, 1];
            if (empty($reminderStages)) {
                continue;
            }
            rsort($reminderStages);

            // stage = la plus petite échéance d telle que left <= d
            $matchedStage = null;
            foreach ($reminderStages as $d) {
                if ($leftDays <= $d) {
                    $matchedStage = $d;
                }
            }

            if ($matchedStage === null || $leftDays < 0) {
                continue;
            }

            // Vérifier si une notification existe déjà
            $existing = array_filter($notifications, fn($n) => $n['user_id'] === $user['id'] && $n['event_id'] === $event['id']);

            $alreadyNotified = false;
            foreach ($existing as $n) {
                $kind = $n['kind'] ?? 'reminder';
                $stage = $n['stage'] !== null ? (int)$n['stage'] : 7;

                if ($kind === 'reminder' && $stage <= $matchedStage) {
                    $alreadyNotified = true;
                    break;
                }

                if (in_array($kind, ['created', 'updated'], true)) {
                    $targetDate = date('Y-m-d', strtotime("-{$matchedStage} days", strtotime($eventStart)));
                    if (substr($n['created_at'], 0, 10) >= $targetDate) {
                        $alreadyNotified = true;
                        break;
                    }
                }
            }

            if ($alreadyNotified) {
                continue;
            }

            $maxSeq++;
            $ntfId = sprintf('ntf-%04d', $maxSeq);
            $targetDate = date('Y-m-d', strtotime("-{$matchedStage} days", strtotime($eventStart)));
            $createdAt = "{$targetDate}T07:00:00";

            $ins->execute([
                $ntfId,
                $user['id'],
                $event['id'],
                $matchedStage,
                $event['title'],
                $createdAt
            ]);

            $notifications[] = [
                'id'         => $ntfId,
                'user_id'    => $user['id'],
                'event_id'   => $event['id'],
                'kind'       => 'reminder',
                'stage'      => $matchedStage,
                'created_at' => $createdAt,
            ];

            $createdCount++;
        }
    }

    return $createdCount;
}

if (PHP_SAPI === 'cli') {
    if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
        $count = syncReminders();
        echo "Rappels synchronisés avec succès ($count nouveau(x)).\n";
    }
} else {
    // Appel web (service de cron externe) : exige le jeton 'cron_token' de config.local.php ; sans jeton configuré, la page n'existe pas
    $config = require __DIR__ . '/../config/config.php';
    $expected = (string)$config['cron_token'];
    $given = (string)($_GET['token'] ?? '');
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ($expected === '' || !hash_equals($expected, $given)) {
        http_response_code(404);
        echo json_encode(['message' => 'Route introuvable.']);
        exit;
    }
    $count = syncReminders();
    echo json_encode(['added' => $count, 'today' => $config['simulated_today'] ?: date('Y-m-d')]);
}
