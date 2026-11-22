<?php
/**
 * Installateur de Suivi Académique (web ou ligne de commande).
 *
 *  - Crée les tables puis, au choix :
 *      « demo »       : jeu de démonstration complet (54 étudiants, 14 enseignants…, un seul compte chef) et date du jour simulée ;
 *      « production » : base vierge avec un seul compte chef de département (+ structure filières / niveaux / UE en option).
 *  - SÉCURITÉ : une fois l'installation terminée, le fichier storage/install.lock verrouille cette page (aucune
 *    réinitialisation possible depuis le web). Avant l'installation, l'accès à distance exige la clé INSTALL_KEY
 *    (config.local.php ou variable d'environnement) ; depuis localhost, aucune clé n'est demandée.
 *  - MISE À JOUR sans perte de données (base créée par une version précédente) : bouton « Mettre à jour » de cette page
 *    (clé d'installation requise) ou `php database/migrate.php`.
 *  - MOT DE PASSE OUBLIÉ : le chef est l'unique utilisateur ; la même page (verrouillée) permet de fixer un nouveau mot de passe,
 *    à condition de connaître la clé d'installation (config.local.php), secret du propriétaire du serveur.
 *  - Ligne de commande : php install.php --mode=demo [--force]
 *                        php install.php --mode=production --chef-email=… --chef-first=… --chef-last=… --chef-password=… [--structure] [--force]
 */

declare(strict_types=1);

require_once __DIR__ . '/src/Installer.php';
require_once __DIR__ . '/src/Passwords.php';

$config = require __DIR__ . '/config/config.php';
$isCli = PHP_SAPI === 'cli';

function run_install(string $mode, array $chef, bool $structure): array
{
    $db = Database::getConnection();
    Installer::migrate($db);
    $counts = $mode === 'demo' ? Installer::seedDemo($db) : Installer::seedProduction($db, $chef, $structure);
    Installer::lock();
    return $counts;
}

// ---- Ligne de commande -----------------------------------------------------------------------------------
if ($isCli) {
    $opts = getopt('', ['mode:', 'chef-email:', 'chef-first:', 'chef-last:', 'chef-password:', 'structure', 'force']);
    if (Installer::isInstalled() && !isset($opts['force'])) {
        fwrite(STDERR, "Déjà installé (storage/install.lock). Utilisez --force pour réinstaller (EFFACE toutes les données).\n");
        exit(1);
    }
    $mode = $opts['mode'] ?? 'demo';
    if (!in_array($mode, ['demo', 'production'], true)) {
        fwrite(STDERR, "--mode doit valoir demo ou production.\n");
        exit(1);
    }
    $chef = ['email' => $opts['chef-email'] ?? '', 'firstName' => $opts['chef-first'] ?? '', 'lastName' => $opts['chef-last'] ?? '', 'password' => $opts['chef-password'] ?? ''];
    if ($mode === 'production' && (!filter_var($chef['email'], FILTER_VALIDATE_EMAIL) || !Passwords::isStrong($chef['password']) || $chef['firstName'] === '' || $chef['lastName'] === '')) {
        fwrite(STDERR, "Mode production : --chef-email, --chef-first, --chef-last et --chef-password (8 caractères, lettres et chiffres) sont requis.\n");
        exit(1);
    }
    $counts = run_install($mode, $chef, isset($opts['structure']));
    echo "Installation ($mode) terminée : " . implode(', ', array_map(fn($k, $v) => "$k=$v", array_keys($counts), $counts)) . "\n";
    exit(0);
}

// ---- Web ---------------------------------------------------------------------------------------------------
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$isLocal = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
$needKey = !$isLocal;
$state = 'form'; // form | installed | disabled | done
$message = null;
$error = null;
$fields = [];
$cronToken = null;

if (Installer::isInstalled()) {
    http_response_code(403);
    $state = 'installed';
    // Mise à jour de la base ou nouveau mot de passe du chef (non destructifs) : exigent la clé d'installation hors localhost
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && (isset($_POST['upgrade']) || isset($_POST['reset_password']))) {
        if ($needKey && ($config['install_key'] === '' || !hash_equals($config['install_key'], (string)($_POST['key'] ?? '')))) {
            $error = "Clé d'installation incorrecte.";
        } elseif (isset($_POST['reset_password'])) {
            $new = (string)($_POST['new_password'] ?? '');
            if (!Passwords::isStrong($new)) {
                $error = 'Mot de passe : au moins 8 caractères, avec des lettres et des chiffres.';
            } elseif ($new !== (string)($_POST['new_password2'] ?? '')) {
                $error = 'La confirmation du mot de passe ne correspond pas.';
            } else {
                try {
                    $db = Database::getConnection();
                    $upd = $db->prepare("UPDATE users SET password_hash = ?, must_change_password = 0, active = 1 WHERE role = 'chef'");
                    $upd->execute([Passwords::hash($new)]);
                    $db->exec('DELETE FROM login_attempts');
                    http_response_code(200);
                    $message = 'Mot de passe du chef de département modifié : vous pouvez vous connecter.';
                } catch (Throwable $ex) {
                    app_log('Réinitialisation du mot de passe : ' . $ex->getMessage());
                    $error = 'La modification a échoué (détails dans storage/logs/app.log).';
                }
            }
        } else {
            try {
                Installer::migrate(Database::getConnection());
                http_response_code(200);
                $message = 'Base de données mise à jour : vos données sont conservées.';
            } catch (Throwable $ex) {
                app_log('Mise à jour : ' . $ex->getMessage());
                $error = "La mise à jour a échoué (détails dans storage/logs/app.log).";
            }
        }
    }
} elseif ($needKey && $config['install_key'] === '') {
    http_response_code(403);
    $state = 'disabled';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $mode = ($_POST['mode'] ?? '') === 'production' ? 'production' : 'demo';
    $chef = ['firstName' => trim((string)($_POST['chef_first'] ?? '')), 'lastName' => trim((string)($_POST['chef_last'] ?? '')), 'email' => strtolower(trim((string)($_POST['chef_email'] ?? ''))), 'password' => (string)($_POST['chef_password'] ?? '')];
    $fields = ['mode' => $mode] + $chef;
    if ($needKey && !hash_equals($config['install_key'], (string)($_POST['key'] ?? ''))) {
        $error = "Clé d'installation incorrecte.";
    } elseif ($mode === 'production') {
        if (mb_strlen($chef['firstName']) < 2 || mb_strlen($chef['lastName']) < 2) {
            $error = 'Indiquez le prénom et le nom du chef de département.';
        } elseif (!filter_var($chef['email'], FILTER_VALIDATE_EMAIL)) {
            $error = "L'adresse e-mail du chef n'est pas valide.";
        } elseif (!Passwords::isStrong($chef['password'])) {
            $error = 'Mot de passe : au moins 8 caractères, avec des lettres et des chiffres.';
        } elseif ($chef['password'] !== (string)($_POST['chef_password2'] ?? '')) {
            $error = 'La confirmation du mot de passe ne correspond pas.';
        }
    }
    if ($error === null) {
        try {
            $counts = run_install($mode, $chef, !empty($_POST['structure']));
            $message = 'Installation terminée (' . ($mode === 'demo' ? 'démonstration' : 'production') . ').';
            $state = 'done';
            $cronToken = bin2hex(random_bytes(16));
        } catch (Throwable $ex) {
            app_log('Installation : ' . $ex->getMessage());
            $error = "L'installation a échoué. Vérifiez la connexion à la base dans config/config.local.php (détails dans storage/logs/app.log).";
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>Installation - Suivi Académique</title>
    <link rel="stylesheet" href="../assets/libs/bootstrap/css/bootstrap.min.css">
    <style>body{background:#f4f6f5}.card{border:0;border-radius:14px;box-shadow:0 10px 30px rgba(11,19,15,.06)}</style>
</head>
<body class="d-flex align-items-center min-vh-100 py-4">
<div class="container" style="max-width:620px">
  <div class="card p-4 p-md-5">
    <h1 class="h4 fw-bold text-center mb-1">Installation de Suivi Académique</h1>
    <p class="text-muted text-center mb-4">Création de la base de données</p>

    <?php if ($state === 'installed'): ?>
      <?php if ($message): ?><div class="alert alert-success"><?= $e($message) ?></div><?php endif; ?>
      <?php if ($error): ?><div class="alert alert-danger"><?= $e($error) ?></div><?php endif; ?>
      <div class="alert alert-secondary">L'application est déjà installée : cette page est verrouillée. Pour réinstaller (ce qui <strong>efface toutes les données</strong>), supprimez le fichier <code>backend/storage/install.lock</code> sur le serveur.</div>
      <form method="POST" class="border rounded p-3" autocomplete="off">
        <p class="small mb-2"><strong>Mise à jour après une nouvelle version</strong> : adapte la base aux nouveautés <strong>sans effacer vos données</strong>.</p>
        <?php if ($needKey): ?><div class="mb-2"><label class="form-label small" for="up_key">Clé d'installation</label><input class="form-control" type="password" id="up_key" name="key" autocomplete="off"></div><?php endif; ?>
        <button class="btn btn-outline-secondary btn-sm" type="submit" name="upgrade" value="1">Mettre à jour la base</button>
      </form>
      <form method="POST" class="border rounded p-3 mt-3" autocomplete="off">
        <p class="small mb-2"><strong>Mot de passe oublié</strong> : fixe un nouveau mot de passe pour le chef de département (vos données sont conservées).</p>
        <?php if ($needKey): ?><div class="mb-2"><label class="form-label small" for="rp_key">Clé d'installation</label><input class="form-control" type="password" id="rp_key" name="key" autocomplete="off"></div><?php endif; ?>
        <div class="row g-2 mb-2">
          <div class="col-md-6"><label class="form-label small" for="new_password">Nouveau mot de passe</label><input class="form-control" type="password" id="new_password" name="new_password" autocomplete="new-password"></div>
          <div class="col-md-6"><label class="form-label small" for="new_password2">Confirmation</label><input class="form-control" type="password" id="new_password2" name="new_password2" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-outline-secondary btn-sm" type="submit" name="reset_password" value="1">Changer le mot de passe</button>
      </form>
    <?php elseif ($state === 'disabled'): ?>
      <div class="alert alert-warning mb-0">L'installation à distance est désactivée. Définissez une clé <code>'install_key'</code> dans <code>backend/config/config.local.php</code> (ou la variable d'environnement <code>INSTALL_KEY</code>), puis rechargez cette page.</div>
    <?php elseif ($state === 'done'): ?>
      <div class="alert alert-success"><strong><?= $e($message) ?></strong></div>
      <ul class="small">
        <li>Cette page est maintenant verrouillée (<code>storage/install.lock</code>).</li>
        <li><strong>Rappels J-7 / J-1</strong> : dans <code>config.local.php</code>, ajoutez <code>'cron_token' =&gt; '<?= $e($cronToken) ?>'</code> et faites appeler chaque jour <code>…/backend/cron/reminders.php?token=<?= $e($cronToken) ?></code> par un service de cron externe (cron-job.org).</li>
        <li>Pensez à <strong>supprimer <code>assets/mock/</code></strong> du serveur si vous êtes en production (données de démonstration).</li>
      </ul>
      <div class="text-center"><a class="btn btn-primary" href="../page-login.html">Aller à la connexion</a></div>
    <?php else: ?>
      <?php if ($error): ?><div class="alert alert-danger"><?= $e($error) ?></div><?php endif; ?>
      <form method="POST" autocomplete="off">
        <?php if ($needKey): ?>
          <div class="mb-3"><label class="form-label" for="key">Clé d'installation</label><input class="form-control" type="password" id="key" name="key" required></div>
        <?php endif; ?>
        <div class="mb-3">
          <div class="form-check"><input class="form-check-input" type="radio" name="mode" id="m-demo" value="demo" <?= ($fields['mode'] ?? 'demo') === 'demo' ? 'checked' : '' ?>>
            <label class="form-check-label" for="m-demo"><strong>Démonstration</strong> : jeu de données fictif complet, date du jour simulée (25/01/2027), compte de démonstration proposé sur la page de connexion.</label></div>
          <div class="form-check mt-2"><input class="form-check-input" type="radio" name="mode" id="m-prod" value="production" <?= ($fields['mode'] ?? '') === 'production' ? 'checked' : '' ?>>
            <label class="form-check-label" for="m-prod"><strong>Production</strong> : base vierge avec un seul compte chef de département.</label></div>
        </div>
        <fieldset class="border rounded p-3 mb-3" id="prod-fields">
          <legend class="float-none w-auto fs-6 px-2">Compte chef de département (production)</legend>
          <div class="row g-2">
            <div class="col-6"><label class="form-label" for="chef_first">Prénom</label><input class="form-control" id="chef_first" name="chef_first" value="<?= $e($fields['firstName'] ?? '') ?>"></div>
            <div class="col-6"><label class="form-label" for="chef_last">Nom</label><input class="form-control" id="chef_last" name="chef_last" value="<?= $e($fields['lastName'] ?? '') ?>"></div>
            <div class="col-12"><label class="form-label" for="chef_email">Adresse e-mail (identifiant de connexion)</label><input class="form-control" type="email" id="chef_email" name="chef_email" value="<?= $e($fields['email'] ?? '') ?>"></div>
            <div class="col-6"><label class="form-label" for="chef_password">Mot de passe</label><input class="form-control" type="password" id="chef_password" name="chef_password"></div>
            <div class="col-6"><label class="form-label" for="chef_password2">Confirmation</label><input class="form-control" type="password" id="chef_password2" name="chef_password2"></div>
            <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" id="structure" name="structure" value="1" checked><label class="form-check-label" for="structure">Importer la structure (filières, niveaux, unités d'enseignement) du jeu de démonstration</label></div></div>
          </div>
        </fieldset>
        <div class="alert alert-warning small">Cette action crée les tables et <strong>efface les données existantes</strong> de la base. Elle n'est possible qu'une seule fois : la page se verrouille ensuite.</div>
        <button class="btn btn-primary w-100 py-2 fw-semibold" type="submit">Installer</button>
      </form>
    <?php endif; ?>
  </div>
</div>
</body>
</html>
