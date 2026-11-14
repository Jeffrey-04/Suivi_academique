<?php
/**
 * Routeur du serveur PHP intégré (développement) : reproduit les règles de .htaccess.
 *   DB_PORT=3306 php -S localhost:8000 -t . tools/dev-router.php
 *  - /backend/api/… est servi par backend/api/index.php (réécriture d'URL) ;
 *  - tout le reste de /backend, /tools, .git et les fichiers internes sont refusés (sauf install.php et cron/reminders.php) ;
 *  - les fichiers statiques du frontend sont servis normalement.
 */

$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$root = dirname(__DIR__);

$forbidden = preg_match('#^/(tools|\.git)(/|$)#', $path)
    || preg_match('#^/backend/(src|config|database|storage|tests|docs|postman)(/|$)#', $path)
    || preg_match('#\.(md|mjs|log|lock|sql|example)$#', $path)
    || preg_match('#^/backend/[^/]+\.(json|md)$#', $path);
if ($forbidden) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Accès interdit.';
    return true;
}

if (preg_match('#^/backend/api(/|$)#', $path) && !is_file($root . $path)) {
    $_SERVER['SCRIPT_NAME'] = '/backend/api/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $root . '/backend/api/index.php';
    chdir($root . '/backend/api');
    require $root . '/backend/api/index.php';
    return true;
}

if (preg_match('#^/backend/#', $path) && !preg_match('#^/backend/(api/|install\.php$|cron/reminders\.php$)#', $path)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Accès interdit.';
    return true;
}

return false; // fichier statique
