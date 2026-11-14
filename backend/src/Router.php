<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/Response.php';

class Router
{
    private array $routes = [];

    public function get(string $pattern, $handler): void
    {
        $this->addRoute('GET', $pattern, $handler);
    }

    public function post(string $pattern, $handler): void
    {
        $this->addRoute('POST', $pattern, $handler);
    }

    public function put(string $pattern, $handler): void
    {
        $this->addRoute('PUT', $pattern, $handler);
    }

    public function patch(string $pattern, $handler): void
    {
        $this->addRoute('PATCH', $pattern, $handler);
    }

    public function delete(string $pattern, $handler): void
    {
        $this->addRoute('DELETE', $pattern, $handler);
    }

    private function addRoute(string $method, string $pattern, $handler): void
    {
        // Normalise pattern (doit commencer par /)
        $pattern = '/' . ltrim($pattern, '/');
        $this->routes[] = [
            'method'  => $method,
            'pattern' => $pattern,
            'handler' => $handler,
        ];
    }

    public function dispatch(): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $this->handleCors($method);
        if ($method === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
        $this->guardOrigin($method);

        $path = $this->resolvePath();
        $body = $this->parseBody();
        $query = $_GET;

        $allowed = [];
        foreach ($this->routes as $route) {
            $params = $this->matchPattern($route['pattern'], $path);
            if ($params === false) {
                continue;
            }
            if ($route['method'] !== $method) {
                $allowed[] = $route['method'];
                continue;
            }
            $handler = $route['handler'];
            if (is_array($handler) && count($handler) === 2) {
                [$class, $action] = $handler;
                $controller = new $class();
                $controller->$action($params, $body, $query);
                return;
            } elseif (is_callable($handler)) {
                $handler($params, $body, $query);
                return;
            }
        }

        if ($allowed) {
            header('Allow: ' . implode(', ', array_unique($allowed)));
            Response::error('Méthode non autorisée.', 405);
        }
        Response::error('Route introuvable.', 404);
    }

    private function resolvePath(): string
    {
        // 1. Paramètre explicite r ou route
        if (!empty($_GET['r'])) {
            $r = '/' . ltrim((string)$_GET['r'], '/');
            unset($_GET['r']);
            return $r;
        }
        if (!empty($_GET['route'])) {
            $r = '/' . ltrim((string)$_GET['route'], '/');
            unset($_GET['route']);
            return $r;
        }

        // 2. PATH_INFO
        if (!empty($_SERVER['PATH_INFO'])) {
            return '/' . trim(rawurldecode($_SERVER['PATH_INFO']), '/');
        }

        // 3. Déduction depuis REQUEST_URI et SCRIPT_NAME
        $uri = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/');
        $scriptName = rawurldecode($_SERVER['SCRIPT_NAME'] ?? '');
        $scriptDir = dirname($scriptName);

        // Si le scriptName est dans l'URI
        if (strpos($uri, $scriptName) === 0) {
            $path = substr($uri, strlen($scriptName));
        } elseif ($scriptDir !== '/' && $scriptDir !== '\\' && strpos($uri, $scriptDir) === 0) {
            $path = substr($uri, strlen($scriptDir));
        } else {
            $path = $uri;
        }

        // Si l'URI commence par /api, on peut le retirer si les routes sont déclarées sans /api
        $path = '/' . trim($path, '/');
        if (strpos($path, '/api/') === 0) {
            $path = substr($path, 4); // garde /...
        } elseif ($path === '/api') {
            $path = '/';
        }

        return $path === '' ? '/' : $path;
    }

    private function matchPattern(string $pattern, string $path): false|array
    {
        // Remplace {param} par regex (?P<param>[^/]+)
        $regex = preg_replace('#\{([a-zA-Z0-9_]+)\}#', '(?P<$1>[^/]+)', $pattern);
        $regex = '#^' . $regex . '$#';

        if (preg_match($regex, $path, $matches)) {
            $params = [];
            foreach ($matches as $key => $val) {
                if (is_string($key)) {
                    $params[$key] = $val;
                }
            }
            return $params;
        }

        return false;
    }

    private function parseBody(): array
    {
        $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length > 1_500_000) {
            Response::error('Requête trop volumineuse.', 413);
        }
        $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
        if (stripos($contentType, 'application/json') !== false) {
            $raw = file_get_contents('php://input');
            if ($raw !== false && trim($raw) !== '') {
                $decoded = json_decode($raw, true);
                if (!is_array($decoded)) {
                    Response::error('Corps de requête JSON invalide.', 400);
                }
                return $decoded;
            }
            return [];
        }
        return $_POST;
    }

    /** Hôte (avec port) d'une origine « https://exemple.cm:8443 », ou null. */
    private static function originHost(string $origin): ?string
    {
        $parts = parse_url($origin);
        if (!$parts || empty($parts['host'])) {
            return null;
        }
        return strtolower($parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : ''));
    }

    private function isAllowedOrigin(string $origin): bool
    {
        $host = self::originHost($origin);
        if ($host === null) {
            return false;
        }
        if ($host === strtolower((string)($_SERVER['HTTP_HOST'] ?? ''))) {
            return true; // même origine
        }
        $config = require __DIR__ . '/../config/config.php';
        foreach ($config['cors']['allowed_origins'] ?? [] as $allowed) {
            if (strtolower(rtrim((string)$allowed, '/')) === strtolower(rtrim($origin, '/'))) {
                return true;
            }
        }
        return false;
    }

    /** CORS : seules la même origine et la liste blanche de config.php peuvent appeler l'API depuis un navigateur. */
    private function handleCors(string $method): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        header('Vary: Origin');
        if ($origin === '') {
            return;
        }
        if (!$this->isAllowedOrigin($origin)) {
            if ($method === 'OPTIONS') {
                http_response_code(403);
                exit;
            }
            return; // pas d'en-têtes CORS : le navigateur bloquera la lecture de la réponse
        }
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Accept, X-Requested-With');
        header('Access-Control-Max-Age: 600');
    }

    /** Protection CSRF : une requête qui modifie des données venant d'un navigateur doit provenir d'une origine autorisée. */
    private function guardOrigin(string $method): void
    {
        if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && !$this->isAllowedOrigin($origin)) {
            Response::error('Origine non autorisée.', 403);
        }
    }
}
