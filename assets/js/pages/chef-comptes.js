/*
 * Chef : gestion des comptes utilisateurs.
 * Recherche, filtres (rôle, statut), tri, pagination, export ; activer / désactiver un compte et réinitialiser un mot de passe.
 * Les droits (chef seulement, jamais sur son propre compte) sont ceux de AccountService.
 */

import { ROLES } from '../config.js';
import { initPage } from '../layout.js';
import { mountExportMenu } from '../components/export-menu.js';
import { AccountService } from '../services/index.js';
import { confirmDialog, openModal, toast } from '../utils/dialogs.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { esc, formatNumber, fullName, normalize } from '../utils/format.js';
import { bindSort, paginate, paginationFooter, sortRows, sortableTh } from '../utils/table.js';
import { emptyState, errorState, userCell } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;

const ctx = await initPage({ role: 'chef', page: 'accounts' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role, profileId: ctx.user.profileId };
    const state = { q: '', role: '', status: '', sort: { key: 'name', dir: 'asc' }, page: 1, highlight: null };
    let accounts = [];

    const getters = {
        name: (a) => `${a.lastName} ${a.firstName}`,
        role: (a) => ROLES[a.role].label,
        status: (a) => (a.active ? 0 : 1),
        password: (a) => (a.mustChangePassword ? 1 : 0),
    };

    const load = async () => {
        accounts = await AccountService.list({}, actor);
    };

    const visible = () => {
        const needle = state.q.trim();
        const wanted = normalize(needle);
        return sortRows(accounts.filter((a) => (!state.role || a.role === state.role) && (!state.status || String(a.active) === state.status)
            && (!wanted || normalize(`${a.firstName} ${a.lastName} ${a.email} ${a.detail ?? ''}`).includes(wanted))), getters[state.sort.key], state.sort.dir);
    };

    function render() {
        const all = visible();
        if (state.highlight) {
            const index = all.findIndex((a) => a.id === state.highlight);
            if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
        }
        const page = paginate(all, state.page, PAGE_SIZE);
        state.page = page.page;
        const inactive = accounts.filter((a) => !a.active).length;
        $('page-subtitle').textContent = `${formatNumber(accounts.length)} comptes · ${formatNumber(inactive)} désactivé${inactive > 1 ? 's' : ''}${all.length !== accounts.length ? ` · ${formatNumber(all.length)} correspondent aux filtres` : ''}`;

        $('table-head').innerHTML = `<tr>
          ${sortableTh('Utilisateur', 'name', state.sort)}
          ${sortableTh('Rôle', 'role', state.sort, { className: 'd-none d-md-table-cell' })}
          ${sortableTh('Statut', 'status', state.sort)}
          ${sortableTh('Mot de passe', 'password', state.sort, { className: 'd-none d-lg-table-cell' })}
          <th class="text-center">Actions</th></tr>`;

        $('table-body').innerHTML = page.items.length ? page.items.map((a) => {
            const name = fullName(a);
            const own = a.id === actor.id;
            const action = (kind, icon, label, extra = '') => (own
                ? `<span class="table-btn-action is-placeholder" aria-hidden="true"><i class="bi ${icon}"></i></span>`
                : `<button type="button" class="table-btn-action${extra}" data-action="${kind}" title="${label}" aria-label="${label} : ${esc(name)}"><i class="bi ${icon}"></i></button>`);
            return `
            <tr data-id="${esc(a.id)}"${a.id === state.highlight ? ' class="row-flash"' : ''}>
              <td>${userCell(a, a.email)}</td>
              <td class="d-none d-md-table-cell">${esc(ROLES[a.role].label)}<div class="table-user-sub">${esc(a.detail ?? '')}</div></td>
              <td><span class="badge-table ${a.active ? 'success' : 'failed'}">${a.active ? 'Actif' : 'Désactivé'}</span>${own ? ' <span class="badge-table pending">Vous</span>' : ''}</td>
              <td class="d-none d-lg-table-cell">${a.mustChangePassword ? '<span class="badge-table pending">Temporaire</span>' : 'Défini'}</td>
              <td><div class="d-flex justify-content-center gap-1">
                ${action('reset', 'bi-key', 'Réinitialiser le mot de passe')}
                ${a.active ? action('deactivate', 'bi-person-slash', 'Désactiver le compte', ' delete') : action('activate', 'bi-person-check', 'Réactiver le compte')}
              </div></td>
            </tr>`;
        }).join('') : `<tr><td colspan="5">${emptyState('Aucun compte ne correspond à votre recherche.', 'bi-person-x')}
            <div class="text-center pb-3"><button type="button" class="btn-table-action" data-action="reset-filters">Réinitialiser les filtres</button></div></td></tr>`;

        $('table-footer').innerHTML = paginationFooter(page, 'comptes');
        state.highlight = null;
    }

    async function refresh(highlight = null) {
        await load();
        state.highlight = highlight;
        render();
    }

    async function toggleActive(account) {
        const deactivate = account.active;
        const confirmed = await confirmDialog({
            title: deactivate ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?',
            message: `${fullName(account)} (${account.email}).`,
            details: deactivate
                ? ['Cette personne ne pourra plus se connecter ; sa session en cours prendra fin.', 'Ses données (notes, séances, bulletins) sont conservées.', 'Elle ne recevra plus de notifications.']
                : ['Cette personne pourra de nouveau se connecter avec son mot de passe actuel.'],
            confirmLabel: deactivate ? 'Désactiver' : 'Réactiver', danger: deactivate,
        });
        if (!confirmed) return;
        try {
            await AccountService.setActive(account.id, !deactivate, actor);
            toast(deactivate ? 'Compte désactivé.' : 'Compte réactivé.');
            await refresh(account.id);
        } catch (error) {
            toast(error.message, { type: 'danger' });
        }
    }

    async function resetPassword(account) {
        const confirmed = await confirmDialog({
            title: 'Réinitialiser le mot de passe ?',
            message: `${fullName(account)} (${account.email}).`,
            details: ['Son mot de passe actuel cessera de fonctionner.', 'Un mot de passe temporaire sera affiché une seule fois : vous devrez le lui communiquer.', 'Elle ou il devra en choisir un nouveau à sa prochaine connexion.'],
            confirmLabel: 'Réinitialiser', danger: true,
        });
        if (!confirmed) return;
        try {
            const { temporaryPassword } = await AccountService.resetPassword(account.id, actor);
            await refresh(account.id);
            const choice = await openModal({
                title: 'Mot de passe temporaire',
                body: `<p class="mb-0">Pour <strong>${esc(fullName(account))}</strong> :</p>
                       <code class="temp-password" aria-label="Mot de passe temporaire">${esc(temporaryPassword)}</code>
                       <p class="stat-hint mb-0">Communiquez-le de façon sûre. Il ne sera plus affiché une fois cette fenêtre fermée.</p>`,
                buttons: [{ id: 'copy', label: 'Copier', className: 'btn-custom-primary' }],
            });
            if (choice === 'copy') {
                try {
                    await navigator.clipboard.writeText(temporaryPassword);
                    toast('Mot de passe copié.');
                } catch {
                    toast('Copie impossible : notez le mot de passe avant de fermer.', { type: 'danger' });
                }
            }
        } catch (error) {
            toast(error.message, { type: 'danger' });
        }
    }

    // --- Interactions ------------------------------------------------------------------------------------
    let timer;
    $('search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; state.page = 1; render(); }, 120); });
    $('filter-role').addEventListener('change', (e) => { state.role = e.target.value; state.page = 1; render(); });
    $('filter-status').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; render(); });
    bindSort($('table-head'), () => state.sort, (sort) => { state.sort = sort; state.page = 1; render(); });
    $('table-footer').addEventListener('click', (e) => {
        const link = e.target.closest('[data-page]');
        if (!link) return;
        e.preventDefault();
        state.page = Number(link.dataset.page);
        render();
    });
    $('table-body').addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        if (button.dataset.action === 'reset-filters') {
            Object.assign(state, { q: '', role: '', status: '', page: 1 });
            $('search').value = ''; $('filter-role').value = ''; $('filter-status').value = '';
            render();
            return;
        }
        const account = accounts.find((a) => a.id === button.closest('tr').dataset.id);
        if (!account) return;
        if (button.dataset.action === 'reset') resetPassword(account);
        else toggleActive(account);
    });

    mountExportMenu($('export-menu'), {
        getSpec() {
            const data = visible();
            if (!data.length) return null;
            return {
                filename: 'comptes',
                sheets: [{
                    name: 'Comptes',
                    title: 'Comptes utilisateurs',
                    subtitle: exportInfo({
                        summary: `${formatNumber(data.length)} compte${data.length > 1 ? 's' : ''}`,
                        filters: describeFilters([['Recherche', $('search')], ['Rôle', $('filter-role')], ['Statut', $('filter-status')]]),
                    }),
                    columns: [
                        { header: 'Nom', width: 20 }, { header: 'Prénom', width: 18 }, { header: 'Adresse e-mail', width: 38 }, { header: 'Rôle', width: 22 },
                        { header: 'Matricule / grade', width: 24 },
                        { header: 'Statut', width: 12, align: 'center', tone: (v) => (v === 'Actif' ? 'good' : 'bad') },
                        { header: 'Mot de passe', width: 16, align: 'center' },
                    ],
                    rows: data.map((a) => [a.lastName, a.firstName, a.email, ROLES[a.role].label, a.detail ?? '', a.active ? 'Actif' : 'Désactivé', a.mustChangePassword ? 'Temporaire' : 'Défini']),
                }],
            };
        },
    });

    // --- Démarrage ---------------------------------------------------------------------------------------
    try {
        await load();
        render();
    } catch (error) {
        console.error(error);
        $('table-body').innerHTML = `<tr><td colspan="5">${errorState()}</td></tr>`;
    }
}
