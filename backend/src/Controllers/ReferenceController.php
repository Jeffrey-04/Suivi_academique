<?php
declare(strict_types=1);

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../Auth.php';

class ReferenceController
{
    public function filieres(): void
    {
        Auth::requireLogin();
        $db = Database::getConnection();
        $stmt = $db->query('SELECT id, code, name FROM filieres ORDER BY id');
        $rows = $stmt->fetchAll();
        Response::json($rows);
    }

    public function levels(): void
    {
        Auth::requireLogin();
        $db = Database::getConnection();
        $stmt = $db->query('SELECT id, name, label, filiere_id AS filiereId FROM levels ORDER BY id');
        $rows = $stmt->fetchAll();
        Response::json($rows);
    }

    public function classes(): void
    {
        Auth::requireLogin();
        $db = Database::getConnection();
        $stmt = $db->query('
            SELECT l.id, l.name, l.label AS levelLabel, l.filiere_id AS filiereId,
                   f.id AS f_id, f.code AS f_code, f.name AS f_name
            FROM levels l
            JOIN filieres f ON f.id = l.filiere_id
            ORDER BY l.id
        ');
        $rows = $stmt->fetchAll();

        $classes = array_map(function ($r) {
            return [
                'id'        => $r['id'],
                'name'      => $r['name'],
                'label'     => $r['name'] . ' · ' . $r['f_name'],
                'filiereId' => $r['filiereId'],
                'filiere'   => [
                    'id'   => $r['f_id'],
                    'code' => $r['f_code'],
                    'name' => $r['f_name'],
                ],
                'short'     => $r['name'] . ' ' . $r['f_code'],
            ];
        }, $rows);

        Response::json($classes);
    }

    public function units(array $params, array $body, array $query): void
    {
        Auth::requireLogin();
        $db = Database::getConnection();

        $sql = 'SELECT id, code, name, type, level_id AS levelId, semester FROM units WHERE 1=1';
        $bindings = [];

        if (!empty($query['levelId'])) {
            $sql .= ' AND level_id = ?';
            $bindings[] = $query['levelId'];
        }
        if (!empty($query['semester'])) {
            $sql .= ' AND semester = ?';
            $bindings[] = $query['semester'];
        }

        $sql .= ' ORDER BY id';
        $stmt = $db->prepare($sql);
        $stmt->execute($bindings);
        $rows = $stmt->fetchAll();

        Response::json($rows);
    }
}

