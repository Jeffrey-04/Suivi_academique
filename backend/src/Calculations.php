<?php
declare(strict_types=1);

class Calculations
{
    public const WEIGHTS = ['CC' => 0.3, 'EXAMEN' => 0.7];
    public const PASS_MARK = 10;
    public const MENTIONS = [
        ['min' => 16, 'label' => 'Très bien'],
        ['min' => 14, 'label' => 'Bien'],
        ['min' => 12, 'label' => 'Assez bien'],
        ['min' => 10, 'label' => 'Passable'],
    ];

    public static function round2($n): float
    {
        return floor(((float)$n) * 100 + 0.5) / 100;
    }

    /**
     * Arrondi « moitié vers le haut » EXACT d'une division d'entiers (aucune erreur de virgule flottante).
     * Les notes ont deux décimales au plus : on calcule en centièmes puis on arrondit une seule fois.
     */
    public static function divRound(int $numerator, int $denominator): int
    {
        return intdiv(2 * $numerator + $denominator, 2 * $denominator);
    }

    public static function toCents($value): int
    {
        return (int)round(((float)$value) * 100);
    }

    public static function round1($n): float
    {
        return round((float)$n, 1);
    }

    /**
     * Moyenne d'une matière pour un étudiant à partir de ses notes validées.
     * La note de rattrapage remplace l'examen.
     * Retourne null si CC ou EXAMEN manque.
     */
    public static function subjectAverage(array $grades): ?float
    {
        $last = function (string $type) use ($grades) {
            $found = array_values(array_filter($grades, fn($g) => ($g['type'] ?? '') === $type));
            if (empty($found)) {
                return null;
            }
            return (float)$found[count($found) - 1]['value'];
        };

        $cc = $last('CC');
        $exam = $last('RATTRAPAGE') ?? $last('EXAMEN');

        if ($cc === null || $exam === null) {
            return null;
        }

        // cc × 0,3 + exam × 0,7 en centièmes : (3 × CC + 7 × EX) / 10, arrondi exact
        $wCc = (int)round(self::WEIGHTS['CC'] * 10);
        $wExam = (int)round(self::WEIGHTS['EXAMEN'] * 10);
        return self::divRound($wCc * self::toCents($cc) + $wExam * self::toCents($exam), 10) / 100;
    }

    /**
     * Moyenne générale pondérée par les coefficients.
     * entries : [['average' => float|null, 'coefficient' => float]]
     */
    public static function generalAverage(array $entries): array
    {
        $totalCoefficient = 0.0;
        foreach ($entries as $e) {
            $totalCoefficient += (float)$e['coefficient'];
        }

        $complete = count($entries) > 0;
        foreach ($entries as $e) {
            if ($e['average'] === null) {
                $complete = false;
                break;
            }
        }

        if (!$complete) {
            return [
                'average'          => null,
                'complete'         => false,
                'totalCoefficient' => self::round2($totalCoefficient),
            ];
        }

        // Σ(moyenne × coefficient) / Σ coefficient en entiers (centièmes de point × centièmes de coefficient)
        $weighted = 0;
        $coefSum = 0;
        foreach ($entries as $e) {
            $c = self::toCents($e['coefficient']);
            $weighted += self::toCents($e['average']) * $c;
            $coefSum += $c;
        }

        $avg = $coefSum > 0 ? self::divRound($weighted, $coefSum) / 100 : null;

        return [
            'average'          => $avg,
            'complete'         => true,
            'totalCoefficient' => self::round2($totalCoefficient),
        ];
    }

    public static function mention(?float $average): ?string
    {
        if ($average === null) {
            return null;
        }
        foreach (self::MENTIONS as $m) {
            if ($average >= $m['min']) {
                return $m['label'];
            }
        }
        return null;
    }

    public static function finalResult(?float $average, bool $rattrapageOpen = false): string
    {
        if ($average === null) {
            return 'Incomplet';
        }
        if ($average >= self::PASS_MARK) {
            return 'Admis';
        }
        return $rattrapageOpen ? 'Rattrapage' : 'Ajourné';
    }

    public static function groupByUnit(array $lines, array $units): array
    {
        $make = function ($unit, array $own) {
            $complete = count($own) > 0;
            $credits = 0.0;
            $weightedSum = 0;
            $coefSum = 0;

            foreach ($own as $l) {
                if ($l['average'] === null) {
                    $complete = false;
                }
                $coef = (float)$l['coefficient'];
                $credits += $coef;
                if ($l['average'] !== null) {
                    $c = self::toCents($coef);
                    $weightedSum += self::toCents($l['average']) * $c;
                    $coefSum += $c;
                }
            }

            $average = ($complete && $coefSum > 0) ? self::divRound($weightedSum, $coefSum) / 100 : null;

            return [
                'unitId'    => $unit['id'] ?? null,
                'code'      => $unit['code'] ?? '',
                'name'      => $unit['name'] ?? '',
                'type'      => $unit['type'] ?? null,
                'credits'   => self::round2($credits),
                'average'   => $average,
                'validated' => ($average !== null && $average >= self::PASS_MARK),
                'lines'     => $own,
            ];
        };

        $groups = [];
        $knownUnitIds = [];

        foreach ($units as $u) {
            $uId = $u['id'];
            $knownUnitIds[$uId] = true;
            $own = array_values(array_filter($lines, fn($l) => ($l['unitId'] ?? null) === $uId));
            if (!empty($own)) {
                $groups[] = $make($u, $own);
            }
        }

        $orphans = array_values(array_filter($lines, fn($l) => empty($l['unitId']) || !isset($knownUnitIds[$l['unitId']])));
        if (!empty($orphans)) {
            $groups[] = $make(['id' => null, 'name' => 'Autres enseignements', 'code' => '', 'type' => null], $orphans);
        }

        return $groups;
    }

    public static function buildReport(array $subjects, array $grades, bool $rattrapageOpen = false, array $units = []): array
    {
        $validated = array_values(array_filter($grades, fn($g) => ($g['status'] ?? '') === 'validee'));

        $lines = [];
        foreach ($subjects as $subject) {
            $sId = $subject['id'];
            $own = array_values(array_filter($validated, fn($g) => ($g['subjectId'] ?? $g['subject_id'] ?? '') === $sId));

            $pick = function (string $type) use ($own) {
                $filtered = array_values(array_filter($own, fn($g) => ($g['type'] ?? '') === $type));
                return !empty($filtered) ? (float)$filtered[count($filtered) - 1]['value'] : null;
            };

            $avg = self::subjectAverage($own);

            $lines[] = [
                'subjectId'   => $sId,
                'unitId'      => $subject['unitId'] ?? $subject['unit_id'] ?? null,
                'code'        => $subject['code'],
                'name'        => $subject['name'],
                'coefficient' => (float)$subject['coefficient'],
                'cc'          => $pick('CC'),
                'exam'        => $pick('EXAMEN'),
                'rattrapage'  => $pick('RATTRAPAGE'),
                'average'     => $avg,
            ];
        }

        $entries = array_map(fn($l) => ['average' => $l['average'], 'coefficient' => $l['coefficient']], $lines);
        $general = self::generalAverage($entries);
        $result = self::finalResult($general['average'], $rattrapageOpen);
        $grouped = self::groupByUnit($lines, $units);

        $acquiredCredits = 0.0;
        if ($result === 'Admis') {
            $acquiredCredits = $general['totalCoefficient'];
        } else {
            foreach ($grouped as $u) {
                if ($u['validated']) {
                    $acquiredCredits += (float)$u['credits'];
                }
            }
        }

        return [
            'lines'            => $lines,
            'units'            => $grouped,
            'average'          => $general['average'],
            'complete'         => $general['complete'],
            'totalCoefficient' => $general['totalCoefficient'],
            'mention'          => self::mention($general['average']),
            'result'           => $result,
            'credits'          => [
                'total'    => $general['totalCoefficient'],
                'acquired' => self::round2($acquiredCredits),
            ],
        ];
    }

    public static function mean(array $values): ?float
    {
        $kept = [];
        foreach ($values as $v) {
            if ($v !== null && is_numeric($v)) {
                $kept[] = (float)$v;
            }
        }
        if (empty($kept)) {
            return null;
        }
        $cents = 0;
        foreach ($kept as $v) {
            $cents += self::toCents($v);
        }
        return self::divRound($cents, count($kept)) / 100;
    }

    public static function appreciation(?float $average, string $result, array $retake = []): string
    {
        if ($average === null) {
            return 'Relevé incomplet : des notes manquent pour établir la moyenne du semestre.';
        }

        $weak = '';
        if (!empty($retake)) {
            $weak = count($retake) > 3
                ? ' ' . count($retake) . ' matières sont à consolider.'
                : ' Matières à consolider : ' . implode(', ', $retake) . '.';
        }

        if ($average >= 16) {
            return 'Résultats excellents. Le jury adresse ses félicitations et encourage à poursuivre sur cette lancée.' . $weak;
        }
        if ($average >= 14) {
            return "Très bon semestre : les résultats sont solides dans l'ensemble des matières." . $weak;
        }
        if ($average >= 12) {
            return 'Bon semestre. Les résultats sont satisfaisants ; quelques efforts permettraient de progresser encore.' . $weak;
        }
        if ($average >= self::PASS_MARK) {
            return 'Semestre validé. Un travail plus régulier est conseillé pour consolider les acquis.' . $weak;
        }
        if ($result === 'Rattrapage') {
            return 'Résultats insuffisants pour valider le semestre. Une session de rattrapage est ouverte : le jury recommande de réviser les matières sous la moyenne.' . $weak;
        }
        return "Résultats insuffisants : le semestre n'est pas validé." . $weak;
    }

    public static function bulletinSnapshot(array $report, array $classmates): array
    {
        $ranked = [];
        foreach ($classmates as $c) {
            if (!empty($c['report']['complete']) && $c['report']['average'] !== null) {
                $ranked[] = (float)$c['report']['average'];
            }
        }
        rsort($ranked);

        $lines = [];
        foreach ($report['lines'] as $i => $line) {
            $classmateAverages = [];
            foreach ($classmates as $c) {
                if (isset($c['report']['lines'][$i]['average'])) {
                    $classmateAverages[] = $c['report']['lines'][$i]['average'];
                }
            }
            $lines[] = array_merge($line, [
                'classAverage' => self::mean($classmateAverages),
            ]);
        }

        $retake = [];
        foreach ($lines as $l) {
            if ($l['average'] !== null && $l['average'] < self::PASS_MARK) {
                $retake[] = $l['name'];
            }
        }

        $rank = null;
        if (!empty($report['complete']) && $report['average'] !== null) {
            $higherCount = 0;
            foreach ($ranked as $v) {
                if ($v > $report['average']) {
                    $higherCount++;
                }
            }
            $rank = $higherCount + 1;
        }

        $unitsWithoutLines = array_map(function ($u) {
            $copy = $u;
            unset($copy['lines']);
            return $copy;
        }, $report['units']);

        return [
            'average'          => $report['average'],
            'mention'          => $report['mention'],
            'result'           => $report['result'],
            'rank'             => $rank,
            'classRanked'      => count($ranked),
            'classSize'        => count($classmates),
            'classAverage'     => self::mean($ranked),
            'totalCoefficient' => $report['totalCoefficient'],
            'credits'          => $report['credits'],
            'units'            => $unitsWithoutLines,
            'lines'            => $lines,
            'retake'           => $retake,
            'appreciation'     => self::appreciation($report['average'], $report['result'], $retake),
        ];
    }

    public static function sameResults(array $a, array $b): bool
    {
        if (
            (float)($a['average'] ?? 0) !== (float)($b['average'] ?? 0) ||
            ($a['rank'] ?? null) != ($b['rank'] ?? null) ||
            ($a['classRanked'] ?? null) != ($b['classRanked'] ?? null) ||
            count($a['lines'] ?? []) !== count($b['lines'] ?? [])
        ) {
            return false;
        }

        $unitsA = $a['units'] ?? [];
        $unitsB = $b['units'] ?? [];
        if (count($unitsA) !== count($unitsB)) {
            return false;
        }

        for ($i = 0; $i < count($unitsA); $i++) {
            $ua = $unitsA[$i];
            $ub = $unitsB[$i];
            if (
                ($ua['unitId'] ?? null) !== ($ub['unitId'] ?? null) ||
                ($ua['average'] ?? null) != ($ub['average'] ?? null) ||
                (float)($ua['credits'] ?? 0) != (float)($ub['credits'] ?? 0)
            ) {
                return false;
            }
        }

        if ((float)($a['credits']['acquired'] ?? 0) != (float)($b['credits']['acquired'] ?? 0)) {
            return false;
        }

        foreach ($a['lines'] as $i => $l) {
            $o = $b['lines'][$i] ?? [];
            if (
                ($l['subjectId'] ?? null) !== ($o['subjectId'] ?? null) ||
                (float)($l['coefficient'] ?? 0) != (float)($o['coefficient'] ?? 0) ||
                ($l['cc'] ?? null) != ($o['cc'] ?? null) ||
                ($l['exam'] ?? null) != ($o['exam'] ?? null) ||
                ($l['rattrapage'] ?? null) != ($o['rattrapage'] ?? null) ||
                ($l['average'] ?? null) != ($o['average'] ?? null)
            ) {
                return false;
            }
        }

        return true;
    }

    public static function toMinutes(string $hhmm): int
    {
        $parts = explode(':', $hhmm);
        return ((int)($parts[0] ?? 0)) * 60 + ((int)($parts[1] ?? 0));
    }

    public static function sessionHours(array $session): float
    {
        $start = $session['startTime'] ?? $session['start_time'] ?? '00:00';
        $end = $session['endTime'] ?? $session['end_time'] ?? '00:00';
        return (self::toMinutes($end) - self::toMinutes($start)) / 60;
    }

    public static function hoursSummary(array $teacher, array $subjects, array $sessions, string $period): array
    {
        $tId = $teacher['id'];
        $planned = 0;
        foreach ($subjects as $s) {
            if (($s['teacherId'] ?? $s['teacher_id'] ?? '') === $tId) {
                $planned += (int)($s['plannedHours'] ?? $s['planned_hours'] ?? 0);
            }
        }

        $done = 0.0;
        foreach ($sessions as $s) {
            if (($s['teacherId'] ?? $s['teacher_id'] ?? '') === $tId && ($s['status'] ?? '') === 'present') {
                $done += self::sessionHours($s);
            }
        }

        $contract = (int)($teacher['contractHours'] ?? $teacher['contract_hours'] ?? 0);
        $doneRounded = self::round2($done);

        return [
            'teacherId' => $tId,
            'period'    => $period,
            'planned'   => $planned,
            'done'      => $doneRounded,
            'contract'  => $contract,
            'overtime'  => self::round2(max(0.0, $doneRounded - $contract)),
            'missing'   => self::round2(max(0.0, $planned - $doneRounded)),
        ];
    }

    public static function presenceRate(array $sessions): ?float
    {
        if (empty($sessions)) {
            return null;
        }
        $present = count(array_filter($sessions, fn($s) => ($s['status'] ?? '') === 'present'));
        return round(($present / count($sessions)) * 100, 1);
    }

    public static function weekStart(string $isoDate): string
    {
        $time = strtotime(substr($isoDate, 0, 10));
        $dayOfWeek = (int)date('N', $time); // 1 (lundi) à 7 (dimanche)
        $mondayTime = strtotime('-' . ($dayOfWeek - 1) . ' days', $time);
        return date('Y-m-d', $mondayTime);
    }
}
