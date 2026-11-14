<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

class Response
{
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function noContent(): void
    {
        http_response_code(204);
        exit;
    }

    public static function error(string $message, int $status = 400): void
    {
        self::json(['message' => $message], $status);
    }

    /** Erreur inattendue : détail dans le journal, message générique pour l'utilisateur (jamais de SQL ni de chemin). */
    public static function serverError(Throwable $e, string $context): void
    {
        app_log($context . ' : ' . get_class($e) . ' ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        $payload = ['message' => $context . '. Réessayez ; si le problème persiste, contactez l\'administrateur.'];
        if (app_debug()) {
            $payload['detail'] = $e->getMessage();
        }
        self::json($payload, 500);
    }

    public static function validationError(string $message, array $fields = [], int $status = 422): void
    {
        $payload = ['message' => $message];
        if (!empty($fields)) {
            $payload['fields'] = (object)$fields;
        }
        self::json($payload, $status);
    }

    /**
     * Convertit une chaîne snake_case en camelCase.
     */
    public static function toCamelCase(string $snake): string
    {
        return lcfirst(str_replace('_', '', ucwords($snake, '_')));
    }

    /**
     * Convertit récursivement les clés d'un tableau associatif en camelCase.
     */
    public static function camelCaseKeys(array $data): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            $camelKey = is_string($key) ? self::toCamelCase($key) : $key;
            if (is_array($value)) {
                $result[$camelKey] = self::camelCaseKeys($value);
            } else {
                $result[$camelKey] = $value;
            }
        }
        return $result;
    }
}

