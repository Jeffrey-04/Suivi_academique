<?php
/**
 * Configuration globale de l'application Suivi Académique.
 *
 * Ordre de priorité (du plus faible au plus fort) :
 *   1. les valeurs par défaut ci-dessous ;
 *   2. les variables d'environnement (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, MAIL_*, APP_URL, CRON_TOKEN, INSTALL_KEY, APP_DEBUG, CORS_ORIGINS) ;
 *   3. le fichier config/config.local.php (non versionné : secrets de la base, clé d'API e-mail, jetons).
 * Le mode de l'instance (« demo » ou « production ») est écrit par l'installateur dans storage/instance.json.
 */

declare(strict_types=1);

date_default_timezone_set('Africa/Douala');

$env = static function (string $name, $default = null) {
    $value = getenv($name);
    return ($value === false || $value === '') ? $default : $value;
};

// Mode de l'instance (écrit par install.php) : « demo » utilise la date simulée du jeu d'essai
$mode = 'production';
$instanceFile = rtrim((string)(getenv('APP_STORAGE_DIR') ?: __DIR__ . '/../storage'), '/') . '/instance.json';
if (is_file($instanceFile)) {
    $instance = json_decode((string)file_get_contents($instanceFile), true);
    if (is_array($instance) && in_array($instance['mode'] ?? '', ['demo', 'production'], true)) {
        $mode = $instance['mode'];
    }
}

$defaultConfig = [
    'mode'  => $mode,
    'debug' => (bool)$env('APP_DEBUG', false), // true : détail des erreurs dans les réponses (développement seulement)

    // Base de données
    'db' => [
        'driver'   => 'mysql',
        'host'     => $env('DB_HOST', '127.0.0.1'),
        'port'     => (int)$env('DB_PORT', 3306),
        'dbname'   => $env('DB_NAME', 'suivi_academique'),
        'username' => $env('DB_USER', 'root'),
        'password' => (string)$env('DB_PASS', ''),
        'charset'  => 'utf8mb4',
    ],

    // Paramètres académiques (renvoyés au frontend par GET /config : source unique de vérité)
    'app_name'          => 'Suivi Académique',
    'department'        => 'Département Informatique',
    'academic_year'     => '2026-2027',
    'current_semester'  => 'S1',
    'semester_start'    => '2026-09-14',
    'session_edit_days' => 15,
    'reminder_days'     => [7, 1],
    'checkin_max_accuracy' => 100, // mètres

    // Date du jour : null = vraie date du serveur. Le mode « demo » la fixe au 25/01/2027 (cohérente avec le jeu d'essai).
    'simulated_today'   => null,

    // Établissement (VALEURS FICTIVES de démonstration : à remplacer dans config.local.php)
    'institution' => [
        'university' => ['fr' => 'UNIVERSITÉ DE DÉMONSTRATION', 'en' => 'DEMONSTRATION UNIVERSITY'],
        'faculty'    => ['fr' => 'FACULTÉ DES SCIENCES ET TECHNIQUES', 'en' => 'FACULTY OF SCIENCE AND TECHNOLOGY'],
        'domain'     => ['fr' => 'SCIENCES ET TECHNOLOGIES', 'en' => 'SCIENCE AND TECHNOLOGY'],
        'location'   => [
            'name'         => 'Campus de démonstration',
            'lat'          => 3.8667,
            'lng'          => 11.5167,
            'radiusMeters' => 300,
            'maxAccuracy'  => 100,
        ],
        'dean' => [
            'title' => ['fr' => "Le Chef d'Établissement", 'en' => 'The Dean / Director'],
            'name'  => 'Pr. Marcel Ekani',
        ],
    ],

    // Barèmes
    'grading' => [
        'weights'  => ['CC' => 0.3, 'EXAMEN' => 0.7],
        'pass_mark' => 10,
        'mentions' => [
            ['min' => 16, 'label' => 'Très bien'],
            ['min' => 14, 'label' => 'Bien'],
            ['min' => 12, 'label' => 'Assez bien'],
            ['min' => 10, 'label' => 'Passable'],
        ],
    ],

    // Sécurité & sessions
    'session' => [
        'name'     => 'SUIVI_SESSID',
        'lifetime' => 86400 * 7, // 7 jours
    ],
    // Origines autorisées à appeler l'API depuis un autre domaine (liste vide = même origine uniquement, recommandé)
    'cors' => [
        'allowed_origins' => array_values(array_filter(array_map('trim', explode(',', (string)$env('CORS_ORIGINS', ''))))),
    ],
    // Jeton protégeant l'URL du cron des rappels (cron/reminders.php?token=…) ; vide = accès web désactivé
    'cron_token'  => (string)$env('CRON_TOKEN', ''),
    // Clé demandée par install.php (sauf depuis localhost) ; vide = installation web refusée à distance
    'install_key' => (string)$env('INSTALL_KEY', ''),

    // E-mails (mot de passe temporaire) : fournisseur « brevo » (API HTTP gratuite), « log » (développement) ou « none »
    'mail' => [
        'provider'   => (string)$env('MAIL_PROVIDER', 'none'),
        'api_key'    => (string)$env('MAIL_API_KEY', ''),
        'api_url'    => (string)$env('MAIL_API_URL', 'https://api.brevo.com/v3/smtp/email'),
        'from_email' => (string)$env('MAIL_FROM_EMAIL', ''),
        'from_name'  => (string)$env('MAIL_FROM_NAME', 'Suivi Académique'),
        'app_url'    => (string)$env('APP_URL', ''), // adresse publique du site, pour le lien de connexion
    ],
];

// Surcharge locale (non versionnée)
$localConfig = null;
$localConfigFile = __DIR__ . '/config.local.php';
if (file_exists($localConfigFile)) {
    $loaded = require $localConfigFile;
    if (is_array($loaded)) {
        $localConfig = $loaded;
        $defaultConfig = array_replace_recursive($defaultConfig, $loaded);
    }
}

if ($defaultConfig['mode'] === 'demo' && !array_key_exists('simulated_today', $localConfig ?? [])) {
    $defaultConfig['simulated_today'] = '2027-01-25';
}

return $defaultConfig;
