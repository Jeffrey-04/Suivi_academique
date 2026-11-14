<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

class Database
{
    private static ?PDO $pdo = null;

    public static function getConnection(): PDO
    {
        if (self::$pdo === null) {
            $config = require __DIR__ . '/../config/config.php';
            $db = $config['db'];

            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=%s',
                $db['host'],
                $db['port'],
                $db['dbname'],
                $db['charset']
            );

            try {
                // PHP 8.4+ : constante déplacée dans Pdo\Mysql (l'ancienne est dépréciée en 8.5)
                $initCommand = defined('Pdo\Mysql::ATTR_INIT_COMMAND') ? constant('Pdo\Mysql::ATTR_INIT_COMMAND') : PDO::MYSQL_ATTR_INIT_COMMAND;
                self::$pdo = new PDO($dsn, $db['username'], $db['password'], [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                    // Les littéraux entre guillemets doubles ("validee") exigent que ANSI_QUOTES soit désactivé
                    $initCommand => "SET NAMES utf8mb4, sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '')",
                ]);
            } catch (PDOException $e) {
                app_log('Connexion à la base impossible : ' . $e->getMessage());
                if (PHP_SAPI === 'cli') {
                    throw $e;
                }
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
                $payload = ['message' => 'Le service est momentanément indisponible. Réessayez dans quelques instants.'];
                if (app_debug()) {
                    $payload['detail'] = $e->getMessage();
                }
                echo json_encode($payload, JSON_UNESCAPED_UNICODE);
                exit;
            }
        }

        return self::$pdo;
    }

    /** Première colonne de la première ligne d'une requête préparée (compteurs, existence…). */
    public static function scalar(string $sql, array $params = [])
    {
        $stmt = self::getConnection()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn();
    }

    public static function setConnection(?PDO $pdo): void
    {
        self::$pdo = $pdo;
    }
}

