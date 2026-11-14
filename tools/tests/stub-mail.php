<?php
// Faux service d'e-mails (API Brevo) pour les tests : enregistre chaque requête reçue dans STUB_MAIL_LOG.
$log = getenv('STUB_MAIL_LOG') ?: sys_get_temp_dir() . '/school-stub-mail.log';
file_put_contents($log, json_encode(['headers' => ['api-key' => $_SERVER['HTTP_API_KEY'] ?? null], 'body' => json_decode(file_get_contents('php://input'), true)], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
http_response_code(201);
header('Content-Type: application/json');
echo '{"messageId":"stub"}';
