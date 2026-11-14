<?php
declare(strict_types=1);

/**
 * Démarrage commun (API, installateur, cron, scripts) : à inclure en premier.
 *  - jamais d'erreur PHP affichée au visiteur (journal dans storage/logs/app.log) ;
 *  - toute exception non rattrapée devient une réponse JSON générique (aucun détail technique) ;
 *  - en-têtes de sécurité de base.
 * Mettre 'debug' => true dans config.local.php pour obtenir le détail des erreurs en développement.
 */

if (defined('APP_BOOTSTRAPPED')) {
    return;
}
define('APP_BOOTSTRAPPED', true);
define('APP_ROOT', dirname(__DIR__));
define('APP_STORAGE', rtrim((string)(getenv('APP_STORAGE_DIR') ?: APP_ROOT . '/storage'), '/'));

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
error_reporting(E_ALL);
date_default_timezone_set('Africa/Douala');

/** Écrit une ligne dans le journal de l'application (jamais lisible depuis le web : storage/ est protégé). */
function app_log(string $message): void
{
    $dir = APP_STORAGE . '/logs';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    $line = '[' . date('Y-m-d H:i:s') . '] ' . str_replace(["\r", "\n"], ' ', $message) . PHP_EOL;
    if (@file_put_contents($dir . '/app.log', $line, FILE_APPEND | LOCK_EX) === false) {
        error_log($message); // dernier recours : journal PHP du serveur
    }
}

function app_debug(): bool
{
    static $debug = null;
    if ($debug === null) {
        $config = require APP_ROOT . '/config/config.php';
        $debug = !empty($config['debug']);
    }
    return $debug;
}

function app_fail(Throwable $e): void
{
    app_log(get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, 'Erreur : ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    $payload = ['message' => "Une erreur est survenue. Réessayez, ou contactez l'administrateur si le problème persiste."];
    if (app_debug()) {
        $payload['detail'] = get_class($e) . ': ' . $e->getMessage();
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

set_exception_handler('app_fail');
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    app_log("PHP[$severity] $message @ $file:$line");
    return true; // traité : rien n'est affiché
});
register_shutdown_function(function (): void {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        app_fail(new ErrorException($error['message'], 0, $error['type'], $error['file'], $error['line']));
    }
});

if (PHP_SAPI !== 'cli') {
    header_remove('X-Powered-By');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
}
