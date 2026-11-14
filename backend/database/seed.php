<?php
declare(strict_types=1);

// Réinitialise la base avec le jeu de DÉMONSTRATION (assets/mock/*.json). Usage : php database/seed.php
// Efface toutes les données : réservé au développement et aux tests.
require_once __DIR__ . '/../src/Installer.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$db = Database::getConnection();
Installer::migrate($db);
$counts = Installer::seedDemo($db);
echo "Jeu de démonstration importé : " . implode(', ', array_map(fn($k, $v) => "$k=$v", array_keys($counts), $counts)) . "\n";
