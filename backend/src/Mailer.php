<?php
declare(strict_types=1);

/**
 * Envoi d'e-mails transactionnels (mot de passe temporaire).
 *
 * Les hébergements gratuits (InfinityFree) bloquent mail() et les connexions SMTP : on passe par l'API HTTP d'un
 * service gratuit. Fournisseur pris en charge : Brevo (300 e-mails/jour gratuits, https://www.brevo.com).
 * Configuration (config.local.php ou variables d'environnement MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM_EMAIL…) :
 *   'mail' => ['provider' => 'brevo', 'api_key' => 'xkeysib-…', 'from_email' => 'adresse validée chez Brevo', 'from_name' => '…', 'app_url' => 'https://…/']
 * Fournisseurs : 'brevo' (réel), 'log' (développement : écrit dans storage/logs/mail.log, MOT DE PASSE EN CLAIR), 'none' (désactivé).
 * Un échec d'envoi ne bloque jamais l'opération : l'appelant reçoit ['sent' => false, 'error' => …] et le mot de passe
 * reste communiqué au chef de département dans la réponse de l'API.
 */
class Mailer
{
    /** @return array{sent: bool, error: ?string} */
    public static function send(string $toEmail, string $toName, string $subject, string $html, string $text): array
    {
        $config = require APP_ROOT . '/config/config.php';
        $mail = $config['mail'] ?? [];
        $provider = (string)($mail['provider'] ?? 'none');

        if ($provider === 'none' || $provider === '') {
            return ['sent' => false, 'error' => 'envoi d\'e-mails désactivé'];
        }
        if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
            return ['sent' => false, 'error' => 'adresse du destinataire invalide'];
        }
        if ($provider === 'log') {
            app_log('MAIL à ' . $toEmail . ' | ' . $subject . ' | ' . str_replace("\n", ' / ', $text));
            return ['sent' => true, 'error' => null];
        }
        if ($provider !== 'brevo') {
            return ['sent' => false, 'error' => 'fournisseur inconnu : ' . $provider];
        }

        $apiKey = (string)($mail['api_key'] ?? '');
        $fromEmail = (string)($mail['from_email'] ?? '');
        if ($apiKey === '' || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            return ['sent' => false, 'error' => 'configuration e-mail incomplète (api_key, from_email)'];
        }

        $payload = json_encode([
            'sender'      => ['name' => (string)($mail['from_name'] ?? $config['app_name']), 'email' => $fromEmail],
            'to'          => [['email' => $toEmail, 'name' => $toName]],
            'subject'     => $subject,
            'htmlContent' => $html,
            'textContent' => $text,
        ], JSON_UNESCAPED_UNICODE);
        $url = (string)($mail['api_url'] ?? 'https://api.brevo.com/v3/smtp/email');
        $headers = ['accept: application/json', 'content-type: application/json', 'api-key: ' . $apiKey];

        [$status, $error] = self::post($url, $headers, (string)$payload);
        if ($status >= 200 && $status < 300) {
            return ['sent' => true, 'error' => null];
        }
        app_log("MAIL échec ($status) vers $toEmail : $error");
        return ['sent' => false, 'error' => $status ? "le service d'e-mail a répondu $status" : 'service d\'e-mail injoignable'];
    }

    /** @return array{0: int, 1: string} statut HTTP (0 si échec réseau) et message */
    private static function post(string $url, array $headers, string $body): array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
            ]);
            $response = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $error = $response === false ? curl_error($ch) : (string)$response;
            curl_close($ch);
            return [$status, substr($error, 0, 300)];
        }
        $context = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body, 'timeout' => 10, 'ignore_errors' => true]]);
        $response = @file_get_contents($url, false, $context);
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int)$m[1];
            }
        }
        return [$status, $response === false ? 'échec de la requête' : substr((string)$response, 0, 300)];
    }

    // ---- Messages --------------------------------------------------------------------------------------------

    private static function layout(string $title, string $intro, string $password, string $loginUrl, string $appName): array
    {
        $e = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $link = $loginUrl !== '' ? "<p><a href=\"{$e($loginUrl)}\">Se connecter</a></p>" : '';
        $html = "<div style=\"font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0B130F\">"
            . "<h2 style=\"color:#072F1F\">{$e($appName)}</h2><p>{$e($intro)}</p>"
            . "<p style=\"font-size:20px;letter-spacing:2px;background:#F4F6F5;padding:12px 16px;border-radius:8px;text-align:center\"><strong>{$e($password)}</strong></p>"
            . "<p>Ce mot de passe est <strong>temporaire</strong> : vous devrez en choisir un nouveau à votre première connexion.</p>{$link}"
            . "<p style=\"color:#6C7E75;font-size:12px\">Si vous n'attendiez pas ce message, ignorez-le ou contactez le chef de département.</p></div>";
        $text = "$appName\n\n$intro\n\nMot de passe temporaire : $password\n\nIl est temporaire : vous devrez en choisir un nouveau à votre première connexion."
            . ($loginUrl !== '' ? "\n\nConnexion : $loginUrl" : '');
        return [$title, $html, $text];
    }

    /** E-mail de bienvenue (compte créé) ou de réinitialisation. @return array{sent: bool, error: ?string} */
    public static function sendTemporaryPassword(string $toEmail, string $toName, string $password, bool $isReset): array
    {
        $config = require APP_ROOT . '/config/config.php';
        $appName = (string)$config['app_name'];
        $base = rtrim((string)($config['mail']['app_url'] ?? ''), '/');
        $loginUrl = $base !== '' ? $base . '/page-login.html' : '';
        [$subject, $html, $text] = self::layout(
            $isReset ? "$appName : votre mot de passe a été réinitialisé" : "$appName : votre compte a été créé",
            $isReset ? 'Bonjour, le chef de département a réinitialisé votre mot de passe.' : 'Bonjour, un compte a été créé pour vous. Voici votre mot de passe temporaire.',
            $password, $loginUrl, $appName
        );
        return self::send($toEmail, $toName, $subject, $html, $text);
    }
}
