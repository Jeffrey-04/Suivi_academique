/*
 * Page « Calendrier » commune aux trois rôles (le balisage des trois calendrier.html est identique).
 *  - tous les rôles consultent : grille du mois ou agenda, filtre par type, fiche détaillée, export (Excel, CSV, .ics) ;
 *  - le chef crée, modifie et supprime (EventService contrôle les droits : l'interface ne fait que masquer les boutons) ;
 *  - chacun ne voit que les événements dont l'audience inclut son rôle (le chef voit tout).
 * Paramètres d'URL : ?event=ID ouvre la fiche (lien des notifications), ?new=1 ouvre la création (chef).
 */

import { config } from '../config.js';
import { EventService, academicYearBounds, resolveSettings } from '../services/index.js';
import { monthKey } from '../utils/calendar-grid.js';
import { AUDIENCES, EVENT_TYPES, eventType } from '../utils/event-types.js';
import { openModal, toast } from '../utils/dialogs.js';
import { downloadBlob, describeFilters, exportInfo } from '../utils/exporter.js';
import { formatDateLong, formatNumber, todayISO } from '../utils/format.js';
import { buildIcs } from '../utils/ics.js';
import { renderInto } from '../utils/ui.js';
import { agendaList, dayEventsList, monthGrid, monthLabel, typeFilters } from './calendar-view.js';
import { confirmDeleteEvent, openEventDetail, openEventForm } from './event-form.js';
import { mountExportMenu } from './export-menu.js';

const $ = (id) => document.getElementById(id);
function preferredView(user) {
    const chosen = resolveSettings(user).calendarView;
    if (chosen === 'month' || chosen === 'agenda') return chosen;
    return window.matchMedia('(max-width: 767.98px)').matches ? 'agenda' : 'month';
}
const monthOf = (iso) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 });

export async function mountCalendarPage(ctx) {
    const { user } = ctx;
    const actor = { id: user.id, role: user.role, profileId: user.profileId };
    const isChef = user.role === 'chef';
    const bounds = academicYearBounds();
    const now = monthOf(todayISO());
    const state = {
        ...now,
        view: preferredView(user), // réglage personnel ; par défaut agenda sur téléphone (la grille y est trop serrée)
        types: new Set(Object.keys(EVENT_TYPES)),
        events: [],
    };

    const visible = () => state.events.filter((e) => state.types.has(e.type));
    const inMonth = (e) => {
        const key = monthKey(state.year, state.month);
        return e.start.slice(0, 7) <= key && (e.end ?? e.start).slice(0, 7) >= key;
    };

    function drawBody() {
        const events = visible();
        $('calendar-body').innerHTML = state.view === 'month'
            ? monthGrid({ year: state.year, month: state.month, events, today: todayISO(), canCreate: isChef })
            : agendaList({
                events: events.filter(inMonth),
                emptyMessage: state.types.size < Object.keys(EVENT_TYPES).length ? 'Aucun événement de ces types ce mois-ci.' : 'Aucun événement ce mois-ci.',
            });
    }

    function redraw() {
        const key = monthKey(state.year, state.month);
        $('cal-title').textContent = monthLabel(state.year, state.month);
        $('cal-prev').disabled = key <= bounds.from.slice(0, 7);
        $('cal-next').disabled = key >= bounds.to.slice(0, 7);
        $('cal-filters').innerHTML = typeFilters(EVENT_TYPES, state.types);
        document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
        drawBody();
    }

    function subtitle() {
        const upcoming = state.events.filter((e) => (e.end ?? e.start) >= todayISO()).length;
        $('page-subtitle').textContent = `Année universitaire ${config.ACADEMIC_YEAR} · ${formatNumber(state.events.length)} événement${state.events.length > 1 ? 's' : ''}, dont ${formatNumber(upcoming)} à venir`;
    }

    async function load() {
        await renderInto(
            $('calendar-body'),
            () => EventService.list({ role: isChef ? undefined : user.role }),
            (events) => { state.events = events; return ''; },
        );
        subtitle();
        redraw();
    }

    function goTo(iso) {
        Object.assign(state, monthOf(iso));
        redraw();
    }

    async function openEvent(id) {
        const event = state.events.find((e) => e.id === id);
        if (!event) return;
        const action = await openEventDetail({ event, actor });
        if (action === 'edit') {
            const saved = await openEventForm({ event, actor });
            if (saved) { await load(); goTo(saved.start); }
        } else if (action === 'delete' && await confirmDeleteEvent(event, actor)) {
            await load();
        }
    }

    async function createEvent(defaults = {}) {
        const saved = await openEventForm({ actor, defaults });
        if (saved) { await load(); goTo(saved.start); }
    }

    async function openDay(iso) {
        const events = visible().filter((e) => e.start <= iso && (e.end ?? e.start) >= iso);
        const id = await openModal({ title: formatDateLong(iso), body: dayEventsList(events) });
        if (id) await openEvent(id);
    }

    // --- Interactions ------------------------------------------------------------------------
    const shift = (delta) => {
        const next = new Date(state.year, state.month + delta, 1);
        state.year = next.getFullYear();
        state.month = next.getMonth();
        redraw();
    };
    $('cal-prev').addEventListener('click', () => shift(-1));
    $('cal-next').addEventListener('click', () => shift(1));
    $('cal-today').addEventListener('click', () => goTo(todayISO()));
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; redraw(); }));
    $('cal-filters').addEventListener('click', (event) => {
        const button = event.target.closest('[data-type]');
        if (!button) return;
        const type = button.dataset.type;
        if (state.types.has(type)) state.types.delete(type); else state.types.add(type);
        redraw();
    });
    $('calendar-body').addEventListener('click', (event) => {
        const add = event.target.closest('[data-day-add]');
        if (add) { createEvent({ start: add.dataset.dayAdd }); return; }
        const more = event.target.closest('[data-day]');
        if (more) { openDay(more.dataset.day); return; }
        const item = event.target.closest('[data-event]');
        if (item) openEvent(item.dataset.event);
    });
    $('calendar-body').addEventListener('keydown', (event) => {
        const item = event.target.closest('li[data-event]');
        if (item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openEvent(item.dataset.event); }
    });

    // --- Création (chef) ---------------------------------------------------------------------
    const addButton = $('btn-add');
    if (isChef) addButton.addEventListener('click', () => createEvent());
    else addButton.remove();

    // --- Exports -----------------------------------------------------------------------------
    mountExportMenu($('export-menu'), {
        getSpec() {
            const rows = visible();
            if (!rows.length) return null;
            const audienceLabel = (e) => e.audience.map((r) => AUDIENCES[r] ?? r).join(', ');
            return {
                filename: 'calendrier',
                sheets: [{
                    name: 'Calendrier',
                    title: `Calendrier académique ${config.ACADEMIC_YEAR}`,
                    subtitle: exportInfo({
                        summary: `${formatNumber(rows.length)} événement${rows.length > 1 ? 's' : ''}`,
                        filters: state.types.size < Object.keys(EVENT_TYPES).length ? [`Types : ${[...state.types].map((t) => eventType(t).label).join(', ')}`] : [],
                    }),
                    columns: [
                        { header: 'Début', type: 'date', width: 13 }, { header: 'Fin', type: 'date', width: 13 },
                        { header: 'Horaire', width: 14, align: 'center' }, { header: 'Type', width: 20 }, { header: 'Titre', width: 44 },
                        { header: 'Lieu', width: 22 }, { header: 'Destinataires', width: 32 }, { header: 'Description', width: 50 },
                    ],
                    rows: rows.map((e) => [
                        e.start, e.end ?? '', e.startTime ? `${e.startTime}${e.endTime ? ` – ${e.endTime}` : ''}` : '',
                        eventType(e.type).label, e.title, e.location ?? '', audienceLabel(e), e.description ?? '',
                    ]),
                }],
            };
        },
    });
    $('btn-ics').addEventListener('click', () => {
        const rows = visible();
        if (!rows.length) { toast('Aucun événement à exporter.', { type: 'info' }); return; }
        const name = `calendrier-${todayISO()}.ics`;
        downloadBlob(new Blob([buildIcs(rows, { stamp: todayISO() })], { type: 'text/calendar;charset=utf-8' }), name);
        toast(`${name} téléchargé : à importer dans votre agenda.`);
    });

    await load();

    // --- Liens profonds ----------------------------------------------------------------------
    const params = new URLSearchParams(window.location.search);
    if (params.has('event') || params.has('new')) window.history.replaceState(null, '', window.location.pathname);
    if (params.has('event')) {
        const event = state.events.find((e) => e.id === params.get('event'));
        if (event) { goTo(event.start); openEvent(event.id); } else toast("Cet événement n'existe plus ou ne vous est pas destiné.", { type: 'info' });
    } else if (isChef && params.has('new')) {
        createEvent();
    }
}
