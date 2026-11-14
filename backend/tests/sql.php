<?php
declare(strict_types=1);

// Exécute une requête SQL (outil des tests, ligne de commande uniquement) : php backend/tests/sql.php "DELETE FROM login_attempts"
require_once __DIR__ . '/../src/Database.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$sql = $argv[1] ?? '';
if ($sql === '') {
    fwrite(STDERR, "Usage : php sql.php \"REQUÊTE\"\n");
    exit(1);
}
$stmt = Database::getConnection()->query($sql);
foreach ($stmt->fetchAll(PDO::FETCH_NUM) as $row) {
    echo implode("\t", array_map('strval', $row)), "\n";
}
