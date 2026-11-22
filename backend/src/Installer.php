<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Ids.php';
require_once __DIR__ . '/Passwords.php';

/**
 * Création du schéma et des données : utilisé par install.php (web), par `php install.php` (ligne de commande)
 * et par database/seed.php (réinitialisation du jeu de démonstration en développement).
 * Source unique du jeu d'essai : assets/mock/*.json (généré par tools/generate-mock.mjs).
 */
class Installer
{
    public const LOCK_FILE = APP_STORAGE . '/install.lock';
    public const INSTANCE_FILE = APP_STORAGE . '/instance.json';

    /** Collections vidées puis réimportées en mode démonstration (ordre : enfants avant parents). */
    private const TABLES = [
        'notifications', 'timetable_exceptions', 'timetable_slots', 'sessions', 'bulletins', 'grades', 'subjects', 'users', 'students',
        'teachers', 'units', 'levels', 'filieres', 'events', 'login_attempts', 'id_sequences',
    ];

    public static function isInstalled(): bool
    {
        return is_file(self::LOCK_FILE);
    }

    public static function mockDir(): string
    {
        foreach ([APP_ROOT . '/../assets/mock', APP_ROOT . '/database/mock'] as $dir) {
            if (is_file($dir . '/users.json')) {
                return $dir;
            }
        }
        throw new RuntimeException("Jeu de données introuvable (assets/mock/*.json).");
    }

    private static function load(string $file): array
    {
        $path = self::mockDir() . '/' . $file;
        if (!is_file($path)) {
            throw new RuntimeException("Fichier $file introuvable.");
        }
        return json_decode((string)file_get_contents($path), true) ?: [];
    }

    public static function migrate(PDO $db): void
    {
        $sql = file_get_contents(APP_ROOT . '/database/schema.sql');
        if (!$sql) {
            throw new RuntimeException('Fichier schema.sql introuvable.');
        }
        $db->exec($sql);
        self::upgrade($db);
    }

    private static function hasTable(PDO $db, string $table): bool
    {
        $st = $db->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
        $st->execute([$table]);
        return (int)$st->fetchColumn() > 0;
    }

    private static function hasColumn(PDO $db, string $table, string $column): bool
    {
        $st = $db->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $st->execute([$table, $column]);
        return (int)$st->fetchColumn() > 0;
    }

    /**
     * Met à niveau une base créée par la version à trois rôles (enseignant / étudiant avec comptes) :
     * un seul compte (le chef), plus de pointage géolocalisé, plus d'audience des événements.
     * Idempotent : sans effet sur une base déjà à jour. Les fiches (étudiants, enseignants, notes, séances…) sont conservées.
     */
    public static function upgrade(PDO $db): void
    {
        if (self::hasTable($db, 'users') && self::hasColumn($db, 'users', 'profile_id')) {
            $chefId = $db->query("SELECT id FROM users WHERE role = 'chef' ORDER BY id LIMIT 1")->fetchColumn();
            if ($chefId === false) {
                throw new RuntimeException('Mise à niveau impossible : aucun compte chef de département dans la base.');
            }
            $db->beginTransaction();
            try {
                // Les actions faites par les anciens comptes enseignants / étudiants sont désormais celles du chef
                $db->prepare("UPDATE grades SET entered_by = ? WHERE entered_by <> ?")->execute([$chefId, $chefId]);
                $db->prepare("UPDATE grades SET validated_by = ? WHERE validated_by IS NOT NULL AND validated_by <> ?")->execute([$chefId, $chefId]);
                $db->prepare("UPDATE sessions SET declared_by = ? WHERE declared_by <> ?")->execute([$chefId, $chefId]);
                $db->prepare("UPDATE events SET created_by = ? WHERE created_by <> ?")->execute([$chefId, $chefId]);
                $db->prepare("UPDATE bulletins SET generated_by = ? WHERE generated_by <> ?")->execute([$chefId, $chefId]);
                $db->prepare("DELETE FROM notifications WHERE user_id <> ?")->execute([$chefId]);
                $db->prepare("DELETE FROM users WHERE role <> 'chef'")->execute();
                $db->prepare("DELETE FROM notifications WHERE kind IN ('created', 'updated')")->execute();
                $db->commit();
            } catch (Throwable $e) {
                $db->rollBack();
                throw $e;
            }
            $db->exec("ALTER TABLE users DROP INDEX idx_users_profile");
            $db->exec("ALTER TABLE users DROP COLUMN profile_id");
            $db->exec("ALTER TABLE users MODIFY role ENUM('chef') NOT NULL DEFAULT 'chef'");
        }
        if (self::hasTable($db, 'events') && self::hasColumn($db, 'events', 'audience')) {
            $db->exec('ALTER TABLE events DROP COLUMN audience');
        }
        if (self::hasTable($db, 'checkins')) {
            $db->exec('DROP TABLE checkins');
            $db->exec("DELETE FROM id_sequences WHERE name = 'chk'");
        }
    }

    private static function truncateAll(PDO $db): void
    {
        $db->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (self::TABLES as $table) {
            $db->exec("TRUNCATE TABLE `$table`");
        }
        $db->exec('SET FOREIGN_KEY_CHECKS = 1');
    }

    /** Filières, niveaux et unités d'enseignement. @return array<string,int> */
    public static function importStructure(PDO $db): array
    {
        $counts = [];
        $stmt = $db->prepare('INSERT INTO filieres (id, code, name) VALUES (?, ?, ?)');
        foreach ($rows = self::load('filieres.json') as $f) {
            $stmt->execute([$f['id'], $f['code'], $f['name']]);
        }
        $counts['filieres'] = count($rows);
        $stmt = $db->prepare('INSERT INTO levels (id, name, label, filiere_id) VALUES (?, ?, ?, ?)');
        foreach ($rows = self::load('levels.json') as $l) {
            $stmt->execute([$l['id'], $l['name'], $l['label'], $l['filiereId']]);
        }
        $counts['levels'] = count($rows);
        $stmt = $db->prepare('INSERT INTO units (id, code, name, type, level_id, semester) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('units.json') as $u) {
            $stmt->execute([$u['id'], $u['code'], $u['name'], $u['type'], $u['levelId'], $u['semester']]);
        }
        $counts['units'] = count($rows);
        return $counts;
    }

    /** Importe le jeu de démonstration complet (les tables sont d'abord vidées). @return array<string,int> */
    public static function seedDemo(PDO $db): array
    {
        self::truncateAll($db);
        $db->exec('SET FOREIGN_KEY_CHECKS = 0');
        $counts = self::importStructure($db);

        $stmt = $db->prepare('INSERT INTO teachers (id, first_name, last_name, grade, email, phone, contract_hours, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('teachers.json') as $t) {
            $stmt->execute([$t['id'], $t['firstName'], $t['lastName'], $t['grade'], $t['email'], $t['phone'] ?? '', (int)$t['contractHours'], $t['photo'] ?? null]);
        }
        $counts['teachers'] = count($rows);

        $stmt = $db->prepare('INSERT INTO students (id, matricule, first_name, last_name, birth_date, birth_place, email, phone, filiere_id, level_id, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('students.json') as $s) {
            $stmt->execute([$s['id'], $s['matricule'], $s['firstName'], $s['lastName'], $s['birthDate'], $s['birthPlace'] ?? '', $s['email'], $s['phone'] ?? '', $s['filiereId'], $s['levelId'], $s['photo'] ?? null]);
        }
        $counts['students'] = count($rows);

        $stmt = $db->prepare('INSERT INTO users (id, email, password_hash, role, first_name, last_name, photo, active, must_change_password, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $demoAccounts = [];
        $users = self::load('users.json');
        foreach ($users as $u) {
            $plain = (string)($u['password'] ?? 'demo1234'); // mot de passe en clair du jeu d'essai : haché à l'import
            $stmt->execute([
                $u['id'], strtolower($u['email']), Passwords::hash($plain), $u['role'],
                $u['firstName'] ?? null, $u['lastName'] ?? null, $u['photo'] ?? null, (int)($u['active'] ?? 1),
                (int)($u['mustChangePassword'] ?? 0), !empty($u['settings']) ? json_encode($u['settings']) : null,
            ]);
            if (!empty($u['demo'])) {
                $demoAccounts[] = ['email' => strtolower($u['email']), 'password' => $plain, 'role' => $u['role'], 'firstName' => $u['firstName'] ?? '', 'lastName' => $u['lastName'] ?? ''];
            }
        }
        $counts['users'] = count($users);

        $stmt = $db->prepare('INSERT INTO subjects (id, code, name, coefficient, planned_hours, level_id, semester, teacher_id, unit_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('subjects.json') as $sb) {
            $stmt->execute([$sb['id'], $sb['code'], $sb['name'], (float)$sb['coefficient'], (int)$sb['plannedHours'], $sb['levelId'], $sb['semester'], $sb['teacherId'] ?: null, $sb['unitId'] ?: null]);
        }
        $counts['subjects'] = count($rows);

        $stmt = $db->prepare('INSERT INTO grades (id, student_id, subject_id, type, value, status, entered_by, entered_at, validated_by, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('grades.json') as $g) {
            $stmt->execute([$g['id'], $g['studentId'], $g['subjectId'], $g['type'], (float)$g['value'], $g['status'], $g['enteredBy'], $g['enteredAt'], $g['validatedBy'] ?? null, $g['validatedAt'] ?? null]);
        }
        $counts['grades'] = count($rows);

        $stmt = $db->prepare('INSERT INTO bulletins (id, student_id, semester, academic_year, average, mention, result, `rank`, class_ranked, class_size, class_average, total_coefficient, credits, units, `lines`, retake, appreciation, generated_at, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('bulletins.json') as $b) {
            $stmt->execute([
                $b['id'], $b['studentId'], $b['semester'], $b['academicYear'], $b['average'] !== null ? (float)$b['average'] : null, $b['mention'] ?? null,
                $b['result'], $b['rank'] ?? null, $b['classRanked'] ?? null, $b['classSize'] ?? null, $b['classAverage'] !== null ? (float)$b['classAverage'] : null,
                $b['totalCoefficient'] !== null ? (float)$b['totalCoefficient'] : null, json_encode($b['credits'] ?? null), json_encode($b['units'] ?? null),
                json_encode($b['lines'] ?? null), json_encode($b['retake'] ?? []), $b['appreciation'] ?? null, $b['generatedAt'], $b['generatedBy'],
            ]);
        }
        $counts['bulletins'] = count($rows);

        $stmt = $db->prepare('INSERT INTO sessions (id, teacher_id, subject_id, date, start_time, end_time, status, declared_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('sessions.json') as $se) {
            $stmt->execute([$se['id'], $se['teacherId'], $se['subjectId'], $se['date'], $se['startTime'], $se['endTime'], $se['status'], $se['declaredBy'], $se['note'] ?? null]);
        }
        $counts['sessions'] = count($rows);

        $stmt = $db->prepare('INSERT INTO timetable_slots (id, subject_id, weekday, start_time, end_time, room, valid_from, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('timetableSlots.json') as $sl) {
            $stmt->execute([$sl['id'], $sl['subjectId'], (int)$sl['weekday'], $sl['startTime'], $sl['endTime'], $sl['room'] ?? null, $sl['validFrom'], $sl['validUntil'] ?? null]);
        }
        $counts['timetableSlots'] = count($rows);

        $stmt = $db->prepare('INSERT INTO timetable_exceptions (slot_id, date, reason) VALUES (?, ?, ?)');
        foreach ($rows = self::load('timetableExceptions.json') as $ex) {
            $stmt->execute([$ex['slotId'], $ex['date'], $ex['reason'] ?? null]);
        }
        $counts['timetableExceptions'] = count($rows);

        $stmt = $db->prepare('INSERT INTO events (id, type, title, start, end, start_time, end_time, location, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('events.json') as $ev) {
            $stmt->execute([$ev['id'], $ev['type'], $ev['title'], $ev['start'], $ev['end'] ?? null, $ev['startTime'] ?? null, $ev['endTime'] ?? null, $ev['location'] ?? null, $ev['description'] ?? null, $ev['createdBy'], $ev['createdAt']]);
        }
        $counts['events'] = count($rows);

        $stmt = $db->prepare('INSERT INTO notifications (id, user_id, event_id, kind, stage, message, `read`, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($rows = self::load('notifications.json') as $n) {
            $stmt->execute([$n['id'], $n['userId'], $n['eventId'], $n['kind'] ?? null, $n['stage'] ?? null, $n['message'], (int)($n['read'] ?? 0), $n['createdAt']]);
        }
        $counts['notifications'] = count($rows);

        $db->exec('SET FOREIGN_KEY_CHECKS = 1');
        Ids::resync($db);
        self::writeInstance('demo', $demoAccounts);
        return $counts;
    }

    /** Base vierge : un seul compte chef de département (et, au choix, la structure filières / niveaux / UE). */
    public static function seedProduction(PDO $db, array $chef, bool $withStructure): array
    {
        self::truncateAll($db);
        $counts = [];
        if ($withStructure) {
            $db->exec('SET FOREIGN_KEY_CHECKS = 0');
            $counts = self::importStructure($db);
            $db->exec('SET FOREIGN_KEY_CHECKS = 1');
        }
        $stmt = $db->prepare('INSERT INTO users (id, email, password_hash, role, first_name, last_name, photo, active, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)');
        $stmt->execute(['usr-chef', strtolower($chef['email']), Passwords::hash($chef['password']), 'chef', $chef['firstName'], $chef['lastName'], 'assets/images/avatar.png']);
        $counts['users'] = 1;
        Ids::resync($db);
        self::writeInstance('production', []);
        return $counts;
    }

    public static function writeInstance(string $mode, array $demoAccounts): void
    {
        if (!is_dir(APP_STORAGE)) {
            mkdir(APP_STORAGE, 0750, true);
        }
        file_put_contents(self::INSTANCE_FILE, json_encode(['mode' => $mode, 'installedAt' => date('c'), 'demoAccounts' => $demoAccounts], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    }

    public static function lock(): void
    {
        file_put_contents(self::LOCK_FILE, date('c') . "\n", LOCK_EX);
    }
}
