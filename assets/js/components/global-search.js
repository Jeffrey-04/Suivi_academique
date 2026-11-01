/*
 * Recherche rapide de la barre du haut. Chaque rôle cherche dans son périmètre :
 *  - chef : étudiants, enseignants, matières, événements ;
 *  - enseignant : ses matières, événements ;
 *  - étudiant : événements.
 * Les résultats mènent à la fiche ou à la page concernée. Les droits sont ceux des services (un rôle ne voit que ses événements).
 */

import { url } from '../config.js';
import { EventService, StudentService, SubjectService, TeacherService } from '../services/index.js';
import { eventType } from '../utils/event-types.js';
import { esc, formatDateRange, fullName, normalize } from '../utils/format.js';

const MIN_CHARS = 2;
const PER_GROUP = 4;

const matches = (needle, ...fields) => normalize(fields.filter(Boolean).join(' ')).includes(needle);

async function search(user, q) {
    const needle = normalize(q.trim());
    const role = user.role;
    const groups = [];
    const tasks = [];

    if (role === 'chef') {
        tasks.push(StudentService.list({ q }).then((items) => groups.push({
            label: 'Étudiants',
            items: items.slice(0, PER_GROUP).map((s) => ({ icon: 'bi-person', title: fullName(s), sub: s.matricule, href: url(`pages/chef/etudiant.html?id=${encodeURIComponent(s.id)}`) })),
        })));
        tasks.push(TeacherService.list().then((items) => groups.push({
            label: 'Enseignants',
            items: items.filter((t) => matches(needle, t.firstName, t.lastName, t.email)).slice(0, PER_GROUP)
                .map((t) => ({ icon: 'bi-person-workspace', title: fullName(t), sub: t.grade, href: url(`pages/chef/enseignant.html?id=${encodeURIComponent(t.id)}`) })),
        })));
    }
    if (role === 'chef' || role === 'enseignant') {
        tasks.push(SubjectService.list(role === 'enseignant' ? { teacherId: user.profileId } : {}).then((items) => groups.push({
            label: 'Matières',
            items: items.filter((s) => matches(needle, s.code, s.name)).slice(0, PER_GROUP).map((s) => ({
                icon: 'bi-book', title: s.name, sub: s.code,
                href: url(role === 'chef' ? `pages/chef/matieres.html?q=${encodeURIComponent(s.code)}` : 'pages/enseignant/matieres.html'),
            })),
        })));
    }
    tasks.push(EventService.list({ role: role === 'chef' ? undefined : role }).then((items) => groups.push({
        label: 'Calendrier',
        items: items.filter((e) => matches(needle, e.title, e.location, eventType(e.type).label)).slice(0, PER_GROUP).map((e) => ({
            icon: eventType(e.type).icon, title: e.title, sub: formatDateRange(e.start, e.end),
            href: url(`pages/${role}/calendrier.html?event=${encodeURIComponent(e.id)}`),
        })),
    })));

    await Promise.all(tasks);
    const order = ['Étudiants', 'Enseignants', 'Matières', 'Calendrier'];
    return groups.filter((g) => g.items.length).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

/** Branche le champ #main-search ; user = utilisateur connecté. */
export function mountGlobalSearch(input, user) {
    const wrapper = input.closest('.navbar-search-wrapper');
    const panel = document.createElement('div');
    panel.className = 'search-results d-none';
    panel.id = 'search-results';
    panel.setAttribute('role', 'listbox');
    wrapper.appendChild(panel);
    input.setAttribute('aria-controls', panel.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');

    let timer = null;
    let run = 0;
    let active = -1;
    const options = () => [...panel.querySelectorAll('.search-result')];
    const close = () => { panel.classList.add('d-none'); input.setAttribute('aria-expanded', 'false'); active = -1; };
    const highlight = (index) => {
        const all = options();
        all.forEach((o, i) => { o.classList.toggle('is-active', i === index); o.setAttribute('aria-selected', String(i === index)); });
        active = index;
        all[index]?.scrollIntoView({ block: 'nearest' });
    };

    async function run_() {
        const q = input.value;
        if (q.trim().length < MIN_CHARS) { close(); return; }
        const mine = ++run;
        try {
            const groups = await search(user, q);
            if (mine !== run) return; // réponse périmée
            panel.innerHTML = groups.length
                ? groups.map((g) => `<div class="search-group" role="group" aria-label="${esc(g.label)}"><div class="search-group-title">${esc(g.label)}</div>${g.items.map((i) => `
                    <a class="search-result" role="option" aria-selected="false" href="${esc(i.href)}"><i class="bi ${esc(i.icon)}" aria-hidden="true"></i><span class="search-result-text"><strong>${esc(i.title)}</strong><small>${esc(i.sub ?? '')}</small></span></a>`).join('')}</div>`).join('')
                : `<div class="search-empty">Aucun résultat pour « ${esc(q.trim())} ».</div>`;
        } catch (error) {
            console.error(error);
            if (mine !== run) return;
            panel.innerHTML = '<div class="search-empty">La recherche a échoué. Réessayez.</div>';
        }
        active = -1;
        panel.classList.remove('d-none');
        input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run_, 150); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= MIN_CHARS && panel.innerHTML) panel.classList.remove('d-none'); });
    input.addEventListener('keydown', (e) => {
        const all = options();
        if (e.key === 'Escape') { close(); input.blur(); }
        else if (e.key === 'ArrowDown' && all.length) { e.preventDefault(); highlight((active + 1) % all.length); }
        else if (e.key === 'ArrowUp' && all.length) { e.preventDefault(); highlight((active - 1 + all.length) % all.length); }
        else if (e.key === 'Enter') { e.preventDefault(); const target = all[active] ?? all[0]; if (target) window.location.href = target.href; }
    });
    // Le bouton loupe lance la même recherche
    wrapper.querySelector('.navbar-search-btn')?.addEventListener('click', () => { input.focus(); run_(); });
    document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) close(); });
}
