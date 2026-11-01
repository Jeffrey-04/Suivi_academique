/*
 * Layout partagé : génère la barre latérale, la barre du haut et le pied de page selon le rôle.
 * Une page ne contient donc que son contenu :
 *
 *   <body class="app-loading">
 *     <div class="main-wrapper"><main>...</main></div>
 *     <script type="module">  import { initPage } from '.../layout.js'; await initPage({ role, page }); </script>
 *
 * Les fonctions render* sont pures (données -> chaîne HTML) ; initPage() s'occupe du DOM.
 */

import { config, ROLES, url } from './config.js';
import { MENUS, QUICK_ACTIONS } from './menus.js';
import { requireRole } from './guard.js';
import { AuthService, NotificationService, resetDemoData, resolveSettings } from './services/index.js';
import { esc, fullName, relativeDay, formatDateRange, today } from './utils/format.js';
import { eventType, TONE_BG, errorState } from './utils/ui.js';
import { showQueuedToasts } from './utils/dialogs.js';
import { mountGlobalSearch } from './components/global-search.js';

const SEARCH_PLACEHOLDER = { chef: 'Rechercher un étudiant, une matière…', enseignant: 'Rechercher une matière, un événement…', etudiant: 'Rechercher un événement…' };

const hrefOf = (item) => (item.soon ? '#' : url(item.href));

// ---- Gabarits ------------------------------------------------------------------

export function renderSidebar({ role, user, page }) {
    const sections = MENUS[role].map((section) => {
        const items = section.items.map((item) => {
            const classes = ['sidebar-menu-link', item.id === page ? 'active' : '', item.soon ? 'is-soon' : ''].filter(Boolean).join(' ');
            const attrs = item.soon ? ' aria-disabled="true" tabindex="-1"' : '';
            const badge = item.soon ? '<span class="sidebar-menu-badge">Bientôt</span>' : '';
            return `
          <li class="sidebar-menu-item">
            <a href="${hrefOf(item)}" class="${classes}" id="menu-${esc(item.id)}" title="${esc(item.label)}"${attrs}>
              <i class="bi ${esc(item.icon)}"></i>
              <span>${esc(item.label)}</span>${badge}
            </a>
          </li>`;
        }).join('');
        return `
      <div class="sidebar-menu-section">
        <div class="sidebar-menu-title">${esc(section.title)}</div>
        <ul class="sidebar-menu-list">${items}
        </ul>
      </div>`;
    }).join('');

    return `
  <div class="sidebar-wrapper" id="sidebar">
    <a href="${url(ROLES[role].home)}" class="sidebar-brand">
      <i class="bi bi-mortarboard-fill"></i>
      <span>${esc(config.APP_NAME)}</span>
    </a>
    <div class="flex-grow-1 overflow-y-auto sidebar-scroll">${sections}
    </div>
    <div class="sidebar-profile">
      <img src="${url(user.photo)}" alt="" class="sidebar-profile-img js-avatar">
      <div class="sidebar-profile-info">
        <div class="sidebar-profile-name">${esc(fullName(user))}</div>
        <div class="sidebar-profile-email">${esc(ROLES[role].label)}</div>
      </div>
    </div>
  </div>`;
}

const NOTIFICATION_LABELS = { created: 'Nouvel événement', updated: 'Événement modifié', reminder: 'Rappel' };

/** calendarHref : page calendrier du rôle ; la notification y ouvre directement la fiche de l'événement. */
function renderNotification(n, calendarHref) {
    const type = eventType(n.event?.type);
    const when = n.event ? `${relativeDay(n.event.start)} · ${formatDateRange(n.event.start, n.event.end)}` : '';
    const href = n.event && calendarHref !== '#' ? `${calendarHref}?event=${encodeURIComponent(n.event.id)}` : '#';
    return `
          <a href="${esc(href)}" class="notification-item" data-notification="${esc(n.id)}">
            <div class="notification-icon ${TONE_BG[type.tone]}"><i class="bi ${type.icon}"></i></div>
            <div class="notification-content">
              <p class="notification-text">${NOTIFICATION_LABELS[n.kind] ?? 'Rappel'} : <strong>${esc(n.message)}</strong></p>
              <span class="notification-time">${esc(when)}</span>
            </div>${n.read ? '' : '\n            <span class="notification-unread-dot"></span>'}
          </a>`;
}

export function renderNavbar({ role, user, notifications, unread, page }) {
    const quick = QUICK_ACTIONS[role];
    const quickMenu = quick.length ? `
        <div class="dropdown ms-2">
          <button class="btn-quick-action dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" id="quick-actions-dropdown">
            <i class="bi bi-plus-lg"></i>
            <span>Créer</span>
          </button>
          <ul class="dropdown-menu dropdown-menu-quick-action" aria-labelledby="quick-actions-dropdown">
            <li class="dropdown-header">Raccourcis</li>
            ${quick.map((a) => `<li><a class="dropdown-item${a.soon ? ' is-soon' : ''}" href="${hrefOf(a)}"><i class="bi ${esc(a.icon)}"></i> ${esc(a.label)}</a></li>`).join('\n            ')}
          </ul>
        </div>` : '';

    const calendarItem = MENUS[role].flatMap((s) => s.items).find((i) => i.id === 'calendar');
    const calendarHref = calendarItem ? hrefOf(calendarItem) : '#';
    const list = notifications.length
        ? notifications.map((n) => renderNotification(n, calendarHref)).join('')
        : '<div class="empty-state"><i class="bi bi-bell-slash"></i><p>Aucune notification.</p></div>';

    return `
    <header class="navbar-custom">
      <div class="navbar-left">
        <button class="btn-desktop-toggle d-none d-xl-flex align-items-center justify-content-center me-3" id="desktop-sidebar-toggle" aria-label="Réduire le menu latéral">
          <i class="bi bi-chevron-bar-left"></i>
        </button>
        <button class="sidebar-toggle-btn me-2" id="sidebar-toggle" aria-label="Afficher le menu">
          <i class="bi bi-list"></i>
        </button>${quickMenu}
      </div>

      <div class="navbar-search-wrapper">
        <input type="search" class="navbar-search-input" placeholder="${esc(SEARCH_PLACEHOLDER[role])}" id="main-search" aria-label="Recherche rapide" role="combobox" aria-autocomplete="list">
        <button class="navbar-search-btn" aria-label="Lancer la recherche"><i class="bi bi-search"></i></button>
      </div>

      <div class="navbar-actions">
        <button class="navbar-action-btn me-1" aria-label="Plein écran" id="btn-fullscreen"><i class="bi bi-arrows-fullscreen"></i></button>
        <div class="dropdown">
          <button class="navbar-action-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" id="btn-notifications" data-bs-auto-close="outside" aria-label="Notifications">
            <i class="bi bi-bell"></i>${unread ? '\n            <span class="navbar-action-badge" id="notification-badge"></span>' : ''}
          </button>
          <div class="dropdown-menu dropdown-menu-end dropdown-menu-notification p-0" aria-labelledby="btn-notifications">
            <div class="notification-header">
              <h6 class="notification-title">Notifications</h6>
              <button class="btn-clear-all" type="button" id="btn-mark-all-read">Tout marquer comme lu</button>
            </div>
            <div class="notification-list" id="notification-list">${list}
            </div>
            <a href="${calendarHref}" class="notification-footer">Voir le calendrier</a>
          </div>
        </div>

        <div class="dropdown ms-2">
          <button class="navbar-profile-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" id="profile-dropdown">
            <img src="${url(user.photo)}" alt="" class="navbar-profile-img js-avatar">
            <span class="navbar-profile-name d-none d-md-inline">${esc(fullName(user))}</span>
            <i class="bi bi-chevron-down navbar-profile-caret"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end dropdown-menu-profile" aria-labelledby="profile-dropdown">
            <li class="dropdown-header">${esc(ROLES[role].label)}</li>
            <li><a class="dropdown-item${page === 'profile' ? ' active' : ''}" href="${url(ROLES[role].profile)}"><i class="bi bi-person"></i> Mon profil</a></li>${config.USE_MOCK ? `
            <li><a class="dropdown-item" href="#" data-action="reset-demo" title="Rétablir les données de démonstration d'origine"><i class="bi bi-arrow-counterclockwise"></i> Réinitialiser la démo</a></li>` : ''}
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" data-action="logout"><i class="bi bi-box-arrow-right"></i> Déconnexion</a></li>
          </ul>
        </div>
      </div>
    </header>`;
}

export function renderFooter() {
    const demo = config.USE_MOCK
        ? '<li><span class="footer-link">Mode démo : données simulées <span class="status-dot"></span></span></li>'
        : '';
    return `
    <footer class="footer-custom">
      <div class="footer-left">
        <span class="footer-logo"><i class="bi bi-mortarboard-fill"></i> ${esc(config.APP_NAME)}</span>
        <span class="footer-separator">|</span>
        <span class="footer-copy">&copy; ${today().getFullYear()} ${esc(config.DEPARTMENT)} · Année ${esc(config.ACADEMIC_YEAR)}</span>
      </div>
      <div class="footer-right"><ul class="footer-links">${demo}</ul></div>
    </footer>`;
}

// ---- Interactions ----------------------------------------------------------------

/** Bandeau affiché tant que le mot de passe est temporaire (compte créé ou réinitialisé par le chef). */
function renderPasswordBanner(role, page) {
    const link = page === 'profile' ? '' : ` <a href="${esc(url(ROLES[role].profile))}#securite" class="alert-link">Changer mon mot de passe</a>`;
    return `<div class="alert alert-warning d-flex align-items-start gap-2 mb-4" role="alert" id="password-banner"><i class="bi bi-shield-exclamation mt-1"></i><div><strong>Votre mot de passe est temporaire.</strong> Choisissez-en un nouveau pour sécuriser votre compte.${link}</div></div>`;
}

function bindLayout({ user }) {
    const sidebar = document.querySelector('.sidebar-wrapper');

    // Menu latéral sur mobile + fond cliquable
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    const closeSidebar = () => { sidebar.classList.remove('show'); overlay.classList.remove('show'); };
    document.getElementById('sidebar-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('show');
        overlay.classList.toggle('show', sidebar.classList.contains('show'));
    });
    overlay.addEventListener('click', closeSidebar);

    // Menu latéral réduit sur desktop (les graphiques doivent se redessiner)
    const minimize = document.getElementById('desktop-sidebar-toggle');
    minimize?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-minimized');
        minimize.querySelector('i').className = document.body.classList.contains('sidebar-minimized') ? 'bi bi-chevron-bar-right' : 'bi bi-chevron-bar-left';
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    });

    // Réglage personnel : menu latéral réduit au chargement (grands écrans seulement)
    if (resolveSettings(user).sidebarCollapsed && window.matchMedia('(min-width: 1200px)').matches) {
        document.body.classList.add('sidebar-minimized');
        if (minimize) minimize.querySelector('i').className = 'bi bi-chevron-bar-right';
    }

    // Plein écran
    const fullscreen = document.getElementById('btn-fullscreen');
    fullscreen?.addEventListener('click', () => {
        const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        action.catch((err) => console.error(`Plein écran impossible : ${err.message}`));
    });
    document.addEventListener('fullscreenchange', () => {
        const icon = fullscreen?.querySelector('i');
        if (icon) icon.className = document.fullscreenElement ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
    });

    // Images de profil manquantes -> avatar par défaut (écoute en capture : les erreurs d'image ne remontent pas,
    // et ce gestionnaire couvre aussi les images insérées plus tard dans les tableaux)
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (img instanceof HTMLImageElement && img.classList.contains('js-avatar') && !img.dataset.fallback) {
            img.dataset.fallback = '1';
            img.src = url('assets/images/avatar.png');
        }
    }, true);

    // Entrées "Bientôt" : ne mènent nulle part
    document.addEventListener('click', (e) => {
        if (e.target.closest('a.is-soon')) e.preventDefault();
    });

    // Notifications : tout marquer comme lu
    document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
        await NotificationService.markAllRead(user.id);
        document.getElementById('notification-badge')?.remove();
        document.querySelectorAll('.notification-unread-dot').forEach((dot) => dot.remove());
    });

    // Une notification ouverte est marquée comme lue avant la navigation vers l'événement
    document.getElementById('notification-list')?.addEventListener('click', async (e) => {
        const item = e.target.closest('[data-notification]');
        if (!item) return;
        const target = item.getAttribute('href');
        e.preventDefault();
        await NotificationService.markRead(item.dataset.notification, user.id).catch(console.error);
        if (target && target !== '#') window.location.href = target;
        else item.querySelector('.notification-unread-dot')?.remove();
    });

    mountGlobalSearch(document.getElementById('main-search'), user);

    // Actions du menu profil
    document.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        e.preventDefault();
        if (action === 'logout') {
            AuthService.logout();
            window.location.replace(url('page-login.html'));
        } else if (action === 'reset-demo' && window.confirm('Rétablir les données de démonstration d\'origine ? Les modifications faites dans ce navigateur seront perdues.')) {
            resetDemoData();
            window.location.reload();
        }
    });
}

// ---- Point d'entrée des pages --------------------------------------------------------

/**
 * À appeler en tête du script de chaque page protégée.
 * Retourne { user, role } une fois le layout affiché, ou null si une redirection est en cours.
 * @param {{ role: 'chef'|'enseignant'|'etudiant', page: string }} options page = id de l'entrée de menu active
 */
export async function initPage({ role, page }) {
    const wrapper = document.querySelector('.main-wrapper');
    try {
        const user = await requireRole(role);
        if (!user) return null; // redirection en cours : la page reste masquée (évite un flash de contenu)

        // Les notifications ne sont pas vitales : si elles échouent, la page s'affiche quand même avec une cloche vide
        let notifications = [];
        let unread = 0;
        try {
            if (config.USE_MOCK) await NotificationService.syncReminders(user); // avec le backend : tâche planifiée côté serveur
            [notifications, unread] = await Promise.all([
                NotificationService.listForUser(user.id, 5),
                NotificationService.unreadCount(user.id),
            ]);
        } catch (error) {
            console.error(error);
        }
        document.body.insertAdjacentHTML('afterbegin', renderSidebar({ role, user, page }));
        wrapper.insertAdjacentHTML('afterbegin', renderNavbar({ role, user, notifications, unread, page }));
        wrapper.insertAdjacentHTML('beforeend', renderFooter());
        if (user.mustChangePassword) wrapper.querySelector('main')?.insertAdjacentHTML('afterbegin', renderPasswordBanner(role, page));
        bindLayout({ user });
        document.body.classList.remove('app-loading');
        if (typeof bootstrap !== 'undefined') showQueuedToasts();
        return { user, role };
    } catch (error) {
        console.error(error);
        wrapper.innerHTML = `<div class="p-4">${errorState("L'application n'a pas pu démarrer. Vérifiez qu'elle est servie par un serveur local (voir le README).")}</div>`;
        document.body.classList.remove('app-loading');
        return null;
    }
}
