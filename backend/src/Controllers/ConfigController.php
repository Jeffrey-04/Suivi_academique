<?php
declare(strict_types=1);

require_once __DIR__ . '/../Response.php';

/**
 * GET /config (public) : paramètres de l'établissement et de l'année en cours, source unique de vérité pour le frontend
 * (date du jour du serveur, année / semestre, identité de l'établissement, position du campus…).
 * Ne contient aucun secret. En mode « demo », liste aussi les comptes de démonstration proposés sur la page de connexion.
 */
class ConfigController
{
    public function show(): void
    {
        $config = require __DIR__ . '/../../config/config.php';
        $payload = [
            'mode'            => $config['mode'],
            'today'           => $config['simulated_today'] ?: date('Y-m-d'),
            'appName'         => $config['app_name'],
            'department'      => $config['department'],
            'academicYear'    => $config['academic_year'],
            'currentSemester' => $config['current_semester'],
            'semesterStart'   => $config['semester_start'],
            'sessionEditDays' => $config['session_edit_days'],
            'reminderDays'    => $config['reminder_days'],
            'institution'     => $config['institution'],
        ];

        if ($config['mode'] === 'demo') {
            $file = APP_STORAGE . '/instance.json';
            $instance = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
            $payload['demoAccounts'] = is_array($instance['demoAccounts'] ?? null) ? $instance['demoAccounts'] : [];
        }

        header('Cache-Control: no-cache');
        Response::json($payload);
    }
}
