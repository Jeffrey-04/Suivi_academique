<?php
declare(strict_types=1);

require_once __DIR__ . '/Calculations.php';

/**
 * Emploi du temps : créneaux hebdomadaires récurrents rattachés à une matière (la matière fixe l'enseignant,
 * la classe et le semestre) et leurs occurrences datées.
 *
 * Statut d'une occurrence (même règle côté frontend en mode simulé : assets/js/services/timetable.js) :
 *   - « done » / « absent » : une séance de la même matière, le même jour, sur une plage horaire qui chevauche le créneau ;
 *   - « cancelled »         : séance annulée (jour férié, salle indisponible…), sauf si une séance a quand même été enregistrée ;
 *   - « upcoming »          : date postérieure à aujourd'hui, rien d'enregistré ;
 *   - « toConfirm »         : date passée (ou du jour), aucune séance enregistrée : le chef doit confirmer ou déclarer l'absence.
 */
class Timetable
{
    public const WEEKDAYS = [1 => 'lundi', 2 => 'mardi', 3 => 'mercredi', 4 => 'jeudi', 5 => 'vendredi', 6 => 'samedi'];
    public const MAX_SPAN_DAYS = 370;

    private const SLOT_SELECT = '
        SELECT t.id, t.subject_id AS subjectId, sub.teacher_id AS teacherId, sub.level_id AS levelId, sub.semester,
               t.weekday, t.start_time AS startTime, t.end_time AS endTime, t.room,
               t.valid_from AS validFrom, t.valid_until AS validUntil
        FROM timetable_slots t
        JOIN subjects sub ON sub.id = t.subject_id';

    // ---- Utilitaires de date et d'heure -------------------------------------------------------------

    public static function weekdayOf(string $iso): int
    {
        return (int)(new DateTimeImmutable($iso))->format('N'); // 1 = lundi … 7 = dimanche
    }

    public static function isDate(string $value): bool
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return false;
        }
        [$y, $m, $d] = array_map('intval', explode('-', $value));
        return checkdate($m, $d, $y);
    }

    private static function overlaps(string $startA, string $endA, string $startB, string $endB): bool
    {
        return Calculations::toMinutes($startA) < Calculations::toMinutes($endB)
            && Calculations::toMinutes($startB) < Calculations::toMinutes($endA);
    }

    /** Y a-t-il au moins une date du jour de semaine donné dans la période commune aux deux créneaux ? */
    private static function shareADate(string $fromA, string $untilA, string $fromB, string $untilB, int $weekday): bool
    {
        $from = max($fromA, $fromB);
        $to = min($untilA, $untilB);
        if ($from > $to) {
            return false;
        }
        $delta = ($weekday - self::weekdayOf($from) + 7) % 7;
        $first = (new DateTimeImmutable($from))->modify("+$delta days")->format('Y-m-d');
        return $first <= $to;
    }

    public static function academicYearBounds(string $academicYear): array
    {
        $first = (int)substr($academicYear, 0, 4);
        return ['from' => sprintf('%04d-09-01', $first), 'to' => sprintf('%04d-08-31', $first + 1)];
    }

    private static function dayFr(string $iso): string
    {
        return date('d/m/Y', strtotime($iso));
    }

    // ---- Lecture des créneaux -------------------------------------------------------------------------

    private static function format(array $row): array
    {
        $row['weekday'] = (int)$row['weekday'];
        return $row;
    }

    /** @param array{teacherId?:?string,levelId?:?string,subjectId?:?string} $filters */
    public static function slots(PDO $db, array $filters = []): array
    {
        $sql = self::SLOT_SELECT . ' WHERE 1=1';
        $bindings = [];
        foreach (['teacherId' => 'sub.teacher_id', 'levelId' => 'sub.level_id', 'subjectId' => 't.subject_id'] as $key => $column) {
            if (!empty($filters[$key])) {
                $sql .= " AND $column = ?";
                $bindings[] = $filters[$key];
            }
        }
        $sql .= ' ORDER BY t.weekday ASC, t.start_time ASC, t.id ASC';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        return array_map([self::class, 'format'], $stmt->fetchAll());
    }

    public static function slot(PDO $db, string $id): ?array
    {
        $stmt = $db->prepare(self::SLOT_SELECT . ' WHERE t.id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ? self::format($row) : null;
    }

    public static function countForSubject(PDO $db, string $subjectId): int
    {
        $stmt = $db->prepare('SELECT COUNT(*) FROM timetable_slots WHERE subject_id = ?');
        $stmt->execute([$subjectId]);
        return (int)$stmt->fetchColumn();
    }

    // ---- Conflits -----------------------------------------------------------------------------------------

    /**
     * Cherche un créneau qui entre en conflit avec le candidat (même jour, horaires et périodes qui se recoupent) :
     * même enseignant, même classe, ou même salle. @return array{field:string,message:string}|null
     */
    public static function findConflict(PDO $db, array $cand, ?string $ownId): ?array
    {
        $sql = self::SLOT_SELECT . ' WHERE t.weekday = ?';
        $bindings = [$cand['weekday']];
        if ($ownId !== null) {
            $sql .= ' AND t.id <> ?';
            $bindings[] = $ownId;
        }
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);

        $codeStmt = $db->prepare('SELECT sub.code, te.first_name, te.last_name FROM subjects sub LEFT JOIN teachers te ON te.id = sub.teacher_id WHERE sub.id = ?');
        $room = isset($cand['room']) ? mb_strtolower(trim((string)$cand['room']), 'UTF-8') : '';
        $roomConflict = null;
        $classConflict = null;

        foreach ($stmt->fetchAll() as $o) {
            if (!self::overlaps($cand['startTime'], $cand['endTime'], $o['startTime'], $o['endTime'])
                || !self::shareADate($cand['validFrom'], $cand['validUntil'], $o['validFrom'], $o['validUntil'], (int)$cand['weekday'])) {
                continue;
            }
            $codeStmt->execute([$o['subjectId']]);
            $info = $codeStmt->fetch() ?: ['code' => '?', 'first_name' => '', 'last_name' => ''];
            $when = sprintf('%s %s-%s', self::WEEKDAYS[(int)$o['weekday']] ?? '', $o['startTime'], $o['endTime']);

            if ($o['teacherId'] === $cand['teacherId']) {
                return ['field' => 'startTime', 'message' => sprintf('Chevauche un autre créneau de cet enseignant : %s (%s).', $when, $info['code'])];
            }
            if ($classConflict === null && $o['levelId'] === $cand['levelId']) {
                $classConflict = ['field' => 'startTime', 'message' => sprintf('La classe a déjà cours à cette heure : %s (%s, %s).', $when, $info['code'], trim($info['first_name'] . ' ' . $info['last_name']))];
            }
            if ($roomConflict === null && $room !== '' && mb_strtolower(trim((string)($o['room'] ?? '')), 'UTF-8') === $room) {
                $roomConflict = ['field' => 'room', 'message' => sprintf('La salle « %s » est déjà occupée : %s (%s).', trim((string)$cand['room']), $when, $info['code'])];
            }
        }
        return $classConflict ?? $roomConflict;
    }

    /**
     * Vérifie qu'un enseignant (nouveau titulaire d'une matière) n'a pas de créneau en conflit avec ceux de la matière.
     * @return string|null message d'erreur
     */
    public static function teacherChangeConflict(PDO $db, string $subjectId, string $newTeacherId): ?string
    {
        $mine = self::slots($db, ['subjectId' => $subjectId]);
        if (!$mine) {
            return null;
        }
        $others = $db->prepare(self::SLOT_SELECT . ' WHERE sub.teacher_id = ? AND t.subject_id <> ?');
        $others->execute([$newTeacherId, $subjectId]);
        foreach ($others->fetchAll() as $o) {
            foreach ($mine as $m) {
                if ((int)$o['weekday'] === $m['weekday']
                    && self::overlaps($m['startTime'], $m['endTime'], $o['startTime'], $o['endTime'])
                    && self::shareADate($m['validFrom'], $m['validUntil'], $o['validFrom'], $o['validUntil'], $m['weekday'])) {
                    return sprintf('Réattribution impossible : cet enseignant a déjà un créneau à la même heure (%s %s-%s).',
                        self::WEEKDAYS[$m['weekday']] ?? '', $m['startTime'], $m['endTime']);
                }
            }
        }
        return null;
    }

    // ---- Validation d'un créneau --------------------------------------------------------------------------

    /** @return array{errors:array<string,string>,data:?array} */
    public static function validate(PDO $db, array $config, array $input, ?string $ownId): array
    {
        $errors = [];

        $subjectId = trim((string)($input['subjectId'] ?? ''));
        $stmt = $db->prepare('SELECT id, code, teacher_id, level_id, semester FROM subjects WHERE id = ?');
        $stmt->execute([$subjectId]);
        $subject = $stmt->fetch();
        if (!$subject) {
            $errors['subjectId'] = 'Choisissez une matière.';
        } elseif (empty($subject['teacher_id'])) {
            $errors['subjectId'] = "Cette matière n'a pas d'enseignant attribué.";
        }

        $weekdayRaw = $input['weekday'] ?? '';
        $weekday = (is_numeric($weekdayRaw) && (float)$weekdayRaw == floor((float)$weekdayRaw)) ? (int)$weekdayRaw : 0;
        if ($weekday < 1 || $weekday > 6) {
            $errors['weekday'] = 'Choisissez un jour de la semaine (du lundi au samedi).';
        }

        $start = trim((string)($input['startTime'] ?? ''));
        $end = trim((string)($input['endTime'] ?? ''));
        $timeRegex = '/^([01]\d|2[0-3]):[0-5]\d$/';
        if (!preg_match($timeRegex, $start)) {
            $errors['startTime'] = "Indiquez l'heure de début (HH:MM).";
        }
        if (!preg_match($timeRegex, $end)) {
            $errors['endTime'] = "Indiquez l'heure de fin (HH:MM).";
        }
        if (!isset($errors['startTime']) && !isset($errors['endTime'])) {
            $hours = (Calculations::toMinutes($end) - Calculations::toMinutes($start)) / 60;
            if ($hours <= 0) {
                $errors['endTime'] = "L'heure de fin doit être postérieure à l'heure de début.";
            } elseif ($hours < 0.5) {
                $errors['endTime'] = 'Durée minimale : 30 minutes.';
            } elseif ($hours > 8) {
                $errors['endTime'] = 'Durée maximale : 8 heures.';
            }
        }

        $room = trim((string)($input['room'] ?? ''));
        if (mb_strlen($room) > 40) {
            $errors['room'] = 'La salle ne doit pas dépasser 40 caractères.';
        }

        $bounds = self::academicYearBounds($config['academic_year']);
        $from = trim((string)($input['validFrom'] ?? ''));
        $until = trim((string)($input['validUntil'] ?? ''));
        $outside = sprintf("La date doit être dans l'année universitaire %s (%s – %s).", $config['academic_year'], self::dayFr($bounds['from']), self::dayFr($bounds['to']));
        if (!self::isDate($from)) {
            $errors['validFrom'] = 'Indiquez le début de la période.';
        } elseif ($from < $bounds['from'] || $from > $bounds['to']) {
            $errors['validFrom'] = $outside;
        }
        if (!self::isDate($until)) {
            $errors['validUntil'] = 'Indiquez la fin de la période.';
        } elseif ($until < $bounds['from'] || $until > $bounds['to']) {
            $errors['validUntil'] = $outside;
        } elseif (!isset($errors['validFrom']) && $until < $from) {
            $errors['validUntil'] = 'La fin de la période doit être postérieure ou égale au début.';
        }

        if (!$errors) {
            $conflict = self::findConflict($db, [
                'teacherId' => $subject['teacher_id'], 'levelId' => $subject['level_id'], 'weekday' => $weekday,
                'startTime' => $start, 'endTime' => $end, 'room' => $room, 'validFrom' => $from, 'validUntil' => $until,
            ], $ownId);
            if ($conflict) {
                $errors[$conflict['field']] = $conflict['message'];
            }
        }

        if ($errors) {
            return ['errors' => $errors, 'data' => null];
        }
        return ['errors' => [], 'data' => [
            'subjectId' => $subject['id'], 'weekday' => $weekday, 'startTime' => $start, 'endTime' => $end,
            'room' => $room !== '' ? $room : null, 'validFrom' => $from, 'validUntil' => $until,
        ]];
    }

    // ---- Occurrences --------------------------------------------------------------------------------------

    /**
     * Occurrences datées des créneaux entre deux dates incluses, avec leur statut.
     * @param array{teacherId?:?string,levelId?:?string,subjectId?:?string,status?:?string} $filters
     */
    public static function occurrences(PDO $db, string $today, string $from, string $to, array $filters = []): array
    {
        $slots = array_filter(
            self::slots($db, $filters),
            fn($s) => $s['validFrom'] <= $to && $s['validUntil'] >= $from
        );
        if (!$slots) {
            return [];
        }

        $exceptions = [];
        foreach ($db->query('SELECT slot_id, date, reason FROM timetable_exceptions WHERE date BETWEEN ' . $db->quote($from) . ' AND ' . $db->quote($to))->fetchAll() as $e) {
            $exceptions[$e['slot_id'] . '|' . $e['date']] = $e['reason'];
        }

        $sessionsBySubjectDate = [];
        $sessionStmt = $db->prepare('SELECT id, subject_id, date, start_time, end_time, status FROM sessions WHERE date BETWEEN ? AND ? ORDER BY start_time ASC, id ASC');
        $sessionStmt->execute([$from, $to]);
        foreach ($sessionStmt->fetchAll() as $s) {
            $sessionsBySubjectDate[$s['subject_id'] . '|' . $s['date']][] = $s;
        }

        $rows = [];
        foreach ($slots as $slot) {
            $cursorFrom = max($from, $slot['validFrom']);
            $cursorTo = min($to, $slot['validUntil']);
            $delta = ($slot['weekday'] - self::weekdayOf($cursorFrom) + 7) % 7;
            $day = (new DateTimeImmutable($cursorFrom))->modify("+$delta days");
            for (; $day->format('Y-m-d') <= $cursorTo; $day = $day->modify('+7 days')) {
                $date = $day->format('Y-m-d');
                $rows[] = self::occurrence($slot, $date, $today, $sessionsBySubjectDate, $exceptions);
            }
        }

        if (!empty($filters['status'])) {
            $rows = array_values(array_filter($rows, fn($o) => $o['status'] === $filters['status']));
        }
        usort($rows, fn($a, $b) => [$a['date'], $a['startTime'], $a['slotId']] <=> [$b['date'], $b['startTime'], $b['slotId']]);
        return $rows;
    }

    private static function occurrence(array $slot, string $date, string $today, array $sessionsBySubjectDate, array $exceptions): array
    {
        $session = null;
        foreach ($sessionsBySubjectDate[$slot['subjectId'] . '|' . $date] ?? [] as $s) {
            if (self::overlaps($slot['startTime'], $slot['endTime'], $s['start_time'], $s['end_time'])) {
                $session = $s;
                break;
            }
        }
        $reason = $exceptions[$slot['id'] . '|' . $date] ?? null;
        $cancelled = array_key_exists($slot['id'] . '|' . $date, $exceptions);

        if ($session) {
            $status = $session['status'] === 'present' ? 'done' : 'absent';
        } elseif ($cancelled) {
            $status = 'cancelled';
        } elseif ($date > $today) {
            $status = 'upcoming';
        } else {
            $status = 'toConfirm';
        }

        return [
            'id'        => $slot['id'] . '@' . $date,
            'slotId'    => $slot['id'],
            'date'      => $date,
            'weekday'   => $slot['weekday'],
            'startTime' => $slot['startTime'],
            'endTime'   => $slot['endTime'],
            'room'      => $slot['room'],
            'subjectId' => $slot['subjectId'],
            'teacherId' => $slot['teacherId'],
            'levelId'   => $slot['levelId'],
            'status'    => $status,
            'sessionId' => $session['id'] ?? null,
            'reason'    => $status === 'cancelled' ? $reason : null,
        ];
    }

    /**
     * Occurrence d'un créneau à une date donnée (pour confirmer, déclarer l'absence, annuler ou rétablir).
     * @return array{slot:?array,occurrence:?array,error:?string}
     */
    public static function find(PDO $db, string $today, string $slotId, string $date): array
    {
        $slot = self::slot($db, $slotId);
        if (!$slot) {
            return ['slot' => null, 'occurrence' => null, 'error' => 'Créneau introuvable.'];
        }
        if (!self::isDate($date)) {
            return ['slot' => $slot, 'occurrence' => null, 'error' => 'Indiquez la date de la séance.'];
        }
        if ($date < $slot['validFrom'] || $date > $slot['validUntil'] || self::weekdayOf($date) !== $slot['weekday']) {
            return ['slot' => $slot, 'occurrence' => null, 'error' => "Ce créneau n'a pas lieu à cette date."];
        }
        $found = self::occurrences($db, $today, $date, $date, ['subjectId' => $slot['subjectId']]);
        foreach ($found as $o) {
            if ($o['slotId'] === $slotId) {
                return ['slot' => $slot, 'occurrence' => $o, 'error' => null];
            }
        }
        return ['slot' => $slot, 'occurrence' => null, 'error' => "Ce créneau n'a pas lieu à cette date."];
    }
}
