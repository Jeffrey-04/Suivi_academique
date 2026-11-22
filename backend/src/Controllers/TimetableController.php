<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';
require_once __DIR__ . '/../Ids.php';
require_once __DIR__ . '/../Timetable.php';
require_once __DIR__ . '/SessionController.php';

/**
 * Emploi du temps (chef seul) : créneaux hebdomadaires, occurrences datées, confirmation d'une séance en un clic,
 * déclaration d'absence, annulation (jour férié…) et rétablissement.
 */
class TimetableController
{
    private static function today(array $config): string
    {
        return $config['simulated_today'] ?: date('Y-m-d');
    }

    public function listSlots(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();
        Response::json(Timetable::slots($db, [
            'teacherId' => $query['teacherId'] ?? null,
            'levelId'   => $query['levelId'] ?? null,
            'subjectId' => $query['subjectId'] ?? null,
        ]));
    }

    public function getSlot(array $params): void
    {
        Auth::requireRole('chef');
        $slot = Timetable::slot(Database::getConnection(), $params['id']);
        if (!$slot) {
            Response::json(['message' => 'Créneau introuvable.'], 404);
        }
        Response::json($slot);
    }

    public function createSlot(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $val = Timetable::validate($db, $config, $body, null);
        if ($val['errors']) {
            Response::validationError('Veuillez corriger les champs signalés.', $val['errors']);
        }
        $d = $val['data'];

        $id = Ids::next($db, 'slt');
        $stmt = $db->prepare('
            INSERT INTO timetable_slots (id, subject_id, weekday, start_time, end_time, room, valid_from, valid_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([$id, $d['subjectId'], $d['weekday'], $d['startTime'], $d['endTime'], $d['room'], $d['validFrom'], $d['validUntil']]);

        Response::json(Timetable::slot($db, $id), 201);
    }

    public function updateSlot(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        if (!Timetable::slot($db, $id)) {
            Response::validationError('Créneau introuvable.');
        }
        $val = Timetable::validate($db, $config, $body, $id);
        if ($val['errors']) {
            Response::validationError('Veuillez corriger les champs signalés.', $val['errors']);
        }
        $d = $val['data'];

        $stmt = $db->prepare('
            UPDATE timetable_slots
            SET subject_id = ?, weekday = ?, start_time = ?, end_time = ?, room = ?, valid_from = ?, valid_until = ?
            WHERE id = ?
        ');
        $stmt->execute([$d['subjectId'], $d['weekday'], $d['startTime'], $d['endTime'], $d['room'], $d['validFrom'], $d['validUntil'], $id]);

        Response::json(Timetable::slot($db, $id));
    }

    public function deleteSlot(array $params): void
    {
        Auth::requireRole('chef');
        $id = $params['id'];
        $db = Database::getConnection();

        if (!Timetable::slot($db, $id)) {
            Response::validationError('Créneau introuvable.');
        }
        // Les annulations du créneau partent avec lui (clé étrangère) ; les séances déjà enregistrées sont conservées
        $db->prepare('DELETE FROM timetable_slots WHERE id = ?')->execute([$id]);

        Response::noContent();
    }

    public function listOccurrences(array $params, array $body, array $query): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $today = self::today($config);
        $db = Database::getConnection();

        $from = (string)($query['from'] ?? '');
        $to = (string)($query['to'] ?? '');
        if ($from === '' && $to === '') {
            // Par défaut : la semaine en cours (lundi → dimanche)
            $monday = (new DateTimeImmutable($today))->modify('-' . (Timetable::weekdayOf($today) - 1) . ' days');
            $from = $monday->format('Y-m-d');
            $to = $monday->modify('+6 days')->format('Y-m-d');
        }
        if (!Timetable::isDate($from) || !Timetable::isDate($to) || $to < $from) {
            Response::validationError('Indiquez une période valide (from et to, AAAA-MM-JJ).');
        }
        $span = (int)round((strtotime($to) - strtotime($from)) / 86400);
        if ($span > Timetable::MAX_SPAN_DAYS) {
            Response::validationError('Période trop longue (' . Timetable::MAX_SPAN_DAYS . ' jours maximum).');
        }

        Response::json(Timetable::occurrences($db, $today, $from, $to, [
            'teacherId' => $query['teacherId'] ?? null,
            'levelId'   => $query['levelId'] ?? null,
            'subjectId' => $query['subjectId'] ?? null,
            'status'    => $query['status'] ?? null,
        ]));
    }

    /**
     * Enregistre la séance correspondant à une occurrence : présente (confirmation) ou absente.
     * Les règles sont celles de SessionController::validateSession (pas de futur, pas de chevauchement…).
     */
    private function record(array $body, string $status): void
    {
        $user = Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $found = Timetable::find($db, self::today($config), (string)($body['slotId'] ?? ''), (string)($body['date'] ?? ''));
        if ($found['error']) {
            Response::validationError($found['error']);
        }
        $occ = $found['occurrence'];
        if ($occ['status'] === 'done' || $occ['status'] === 'absent') {
            Response::validationError('Une séance est déjà enregistrée pour ce créneau à cette date.');
        }
        if ($occ['status'] === 'cancelled') {
            Response::validationError('Ce créneau est annulé à cette date : rétablissez-le d\'abord.');
        }

        $val = SessionController::validateSession([
            'subjectId' => $occ['subjectId'],
            'date'      => $occ['date'],
            'startTime' => $occ['startTime'],
            'endTime'   => $occ['endTime'],
            'note'      => $body['note'] ?? '',
        ], $db, $config);
        if (!empty($val['errors'])) {
            Response::validationError((string)reset($val['errors']), $val['errors']);
        }

        $note = $val['note'] !== '' ? $val['note'] : null;
        if ($status === 'absent' && $note === null) {
            $note = 'Raison non communiquée';
        }
        Response::json(SessionController::insertSession($db, $val, $status, $user['id'], $note), 201);
    }

    public function confirm(array $params, array $body): void
    {
        $this->record($body, 'present');
    }

    public function absence(array $params, array $body): void
    {
        $this->record($body, 'absent');
    }

    public function cancel(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $config = require __DIR__ . '/../../config/config.php';
        $db = Database::getConnection();

        $found = Timetable::find($db, self::today($config), (string)($body['slotId'] ?? ''), (string)($body['date'] ?? ''));
        if ($found['error']) {
            Response::validationError($found['error']);
        }
        $occ = $found['occurrence'];
        if ($occ['status'] === 'done' || $occ['status'] === 'absent') {
            Response::validationError('Une séance est déjà enregistrée à cette date : retirez-la d\'abord.');
        }
        if ($occ['status'] === 'cancelled') {
            Response::validationError('Ce créneau est déjà annulé à cette date.');
        }

        $reason = trim((string)($body['reason'] ?? ''));
        if (mb_strlen($reason) > 120) {
            Response::validationError('Veuillez corriger les champs signalés.', ['reason' => 'Motif trop long (120 caractères maximum).']);
        }

        $db->prepare('INSERT INTO timetable_exceptions (slot_id, date, reason) VALUES (?, ?, ?)')
            ->execute([$occ['slotId'], $occ['date'], $reason !== '' ? $reason : null]);

        Response::json(['slotId' => $occ['slotId'], 'date' => $occ['date'], 'reason' => $reason !== '' ? $reason : null], 201);
    }

    public function restore(array $params, array $body): void
    {
        Auth::requireRole('chef');
        $db = Database::getConnection();

        $slotId = (string)($body['slotId'] ?? '');
        $date = (string)($body['date'] ?? '');
        $del = $db->prepare('DELETE FROM timetable_exceptions WHERE slot_id = ? AND date = ?');
        $del->execute([$slotId, $date]);
        if ($del->rowCount() === 0) {
            Response::validationError("Ce créneau n'est pas annulé à cette date.");
        }

        Response::noContent();
    }
}
