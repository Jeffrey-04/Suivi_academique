<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';

/**
 * Identifiants lisibles (« stu-055 », « ses-0871 ») sans collision, même avec deux requêtes simultanées :
 * un compteur par préfixe (table id_sequences) incrémenté de façon atomique.
 */
class Ids
{
    /** Préfixes autorisés → [table, largeur]. Liste blanche : aucun nom de table ne vient de l'extérieur. */
    private const KINDS = [
        'stu' => ['students', 3], 'tea' => ['teachers', 3], 'sub' => ['subjects', 3], 'grd' => ['grades', 4],
        'blt' => ['bulletins', 3], 'ses' => ['sessions', 4], 'chk' => ['checkins', 4], 'evt' => ['events', 3], 'ntf' => ['notifications', 4],
    ];

    public static function next(PDO $db, string $prefix): string
    {
        if (!isset(self::KINDS[$prefix])) {
            throw new InvalidArgumentException("Préfixe d'identifiant inconnu : $prefix");
        }
        [$table, $width] = self::KINDS[$prefix];

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $upd = $db->prepare('UPDATE id_sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = ?');
            $upd->execute([$prefix]);
            if ($upd->rowCount() === 0) {
                self::initialize($db, $prefix, $table);
                continue;
            }
            $n = (int)$db->query('SELECT LAST_INSERT_ID()')->fetchColumn();
            $id = sprintf('%s-%0' . $width . 'd', $prefix, $n);
            // Le compteur peut être en retard si des données ont été importées à la main : on saute les ids déjà pris.
            $exists = $db->prepare("SELECT 1 FROM `$table` WHERE id = ?");
            $exists->execute([$id]);
            if (!$exists->fetchColumn()) {
                return $id;
            }
        }
        throw new RuntimeException("Impossible de générer un identifiant pour $prefix.");
    }

    /** Crée le compteur à partir du plus grand identifiant existant. */
    public static function initialize(PDO $db, string $prefix, string $table): void
    {
        $stmt = $db->prepare("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(id, '-', -1) AS UNSIGNED)), 0) FROM `$table` WHERE id LIKE ?");
        $stmt->execute([$prefix . '-%']);
        $max = (int)$stmt->fetchColumn();
        $ins = $db->prepare('INSERT IGNORE INTO id_sequences (name, value) VALUES (?, ?)');
        $ins->execute([$prefix, $max]);
    }

    /** Recale tous les compteurs (après un import de données). */
    public static function resync(PDO $db): void
    {
        $db->exec('DELETE FROM id_sequences');
        foreach (self::KINDS as $prefix => [$table]) {
            self::initialize($db, $prefix, $table);
        }
    }
}
