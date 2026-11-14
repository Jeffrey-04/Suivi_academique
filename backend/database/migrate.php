<?php
declare(strict_types=1);

// Création / mise à jour du schéma (idempotent). Usage : php database/migrate.php
require_once __DIR__ . '/../src/Installer.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
Installer::migrate(Database::getConnection());
echo "Schéma à jour.\n";
