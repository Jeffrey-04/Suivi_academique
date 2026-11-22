/*
 * Chef : emploi du temps des enseignants.
 *
 * Trois affichages :
 *  - « Semaine » : la grille de la semaine (lundi → samedi), chaque séance prévue avec son statut ;
 *  - « À confirmer » : les séances prévues, déjà passées, dont rien n'est enregistré (confirmer, déclarer l'absence ou annuler) ;
 *  - « Créneaux » : la liste des créneaux hebdomadaires (modifier, supprimer).
 * Les contrôles sont ceux de TimetableService : la page affiche ses messages et n'en réimplémente aucun.
 */

import { config } from '../config.js';
import { initPage } from '../layout.js';
import { mountExportMenu } from '../components/export-menu.js';
import { confirmDeleteSlot, openSlotForm } from '../components/timetable-form.js';
import { OCCURRENCE_STATUS, ReferenceService, SubjectService, TeacherService, TimetableService, ValidationError, WEEKDAYS, weekdayOf } from '../services/index.js';
import { describeFilters, exportInfo } from '../utils/exporter.js';
import { openFormModal, openModal, toast } from '../utils/dialogs.js';
import { addDays, esc, formatDate, formatDateLong, formatNumber, fullName, todayISO } from '../utils/format.js';
import { inputField } from '../components/fields.js';
import { paginate, paginationFooter } from '../utils/table.js';
import { emptyState, errorState, statCard } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 10;
const STATUS_BADGE = { toConfirm: 'pending', done: 'success', absent: 'failed', cancelled: 'neutral', upcoming: 'neutral' };
const mondayOf = (iso) => addDays(iso, 1 - weekdayOf(iso));
const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const ctx = await initPage({ role: 'chef', page: 'timetable' });

if (ctx) {
    const actor = { id: ctx.user.id, role: ctx.user.role };
    const state = { tab: '', teacherId: '', levelId: '', weekStart: '', pageConfirm: 1, pageSlots: 1 };
    let teacherById = new Map();
    let subjectById = new Map();
    let classById = new Map();
    let semester = []; // occurrences du semestre jusqu'à aujourd'hui (selon les filtres)
    let weekRows = [];
    let slots = [];
    let run = 0;

    const filters = () => ({ teacherId: state.teacherId || undefined, levelId: state.levelId || undefined });
    const sinceStart = () => { const floor = addDays(todayISO(), -366); return config.SEMESTER_START > floor ? config.SEMESTER_START : floor; };

    /** Libellés d'une occurrence ou d'un créneau (matière, enseignant, classe). */
    const describe = (o) => {
        const subject = subjectById.get(o.subjectId);
        const teacher = teacherById.get(o.teacherId);
        const cls = classById.get(o.levelId);
        return { code: subject?.code ?? '?', name: subject?.name ?? 'Matière supprimée', teacher: teacher ? fullName(teacher) : '—', cls: cls?.short ?? '—' };
    };

    // ---- Rendu -------------------------------------------------------------------------------------
    function renderKpis() {
        const count = (status) => semester.filter((o) => o.status === status).length;
        const toConfirm = count('toConfirm');
        $('kpis').innerHTML =
            statCard({ label: 'À confirmer', value: formatNumber(toConfirm), icon: 'bi-hourglass-split', hint: 'séances passées, rien d\'enregistré', col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Effectuées', value: formatNumber(count('done')), icon: 'bi-check2-circle', hint: 'depuis le début du semestre', col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Absences', value: formatNumber(count('absent')), icon: 'bi-person-x', hint: 'enseignant absent', col: 'col-sm-6 col-xl-3' }) +
            statCard({ label: 'Annulées', value: formatNumber(count('cancelled')), icon: 'bi-calendar-x', hint: 'jours fériés, indisponibilités', col: 'col-sm-6 col-xl-3' });
        $('page-subtitle').textContent = `${formatNumber(slots.length)} créneau${slots.length > 1 ? 'x' : ''} hebdomadaire${slots.length > 1 ? 's' : ''}${toConfirm ? ` · ${formatNumber(toConfirm)} séance${toConfirm > 1 ? 's' : ''} à confirmer` : ''}`;
    }

    function renderTabs() {
        const toConfirm = semester.filter((o) => o.status === 'toConfirm').length;
        const tabs = [['week', 'Semaine', ''], ['confirm', 'À confirmer', toConfirm], ['slots', 'Créneaux', slots.length]];
        $('tabs').innerHTML = tabs.map(([id, label, count]) =>
            `<button type="button" class="segmented-btn${id === state.tab ? ' active' : ''}" data-tab="${id}" aria-pressed="${id === state.tab}">${esc(label)}${count === '' ? '' : ` <span class="segmented-count">${formatNumber(count)}</span>`}</button>`).join('');
    }

    function slotButton(o) {
        const d = describe(o);
        return `
          <button type="button" class="tt-slot tt-${esc(o.status)}" data-occ="${esc(o.id)}" aria-label="${esc(`${d.code} ${o.startTime}-${o.endTime}, ${OCCURRENCE_STATUS[o.status]}`)}">
            <span class="tt-slot-time">${esc(o.startTime)} - ${esc(o.endTime)}</span>
            <span class="tt-slot-title">${esc(d.code)} · ${esc(d.name)}</span>
            <span class="tt-slot-meta">${esc(d.teacher)} · ${esc(d.cls)}${o.room ? ` · ${esc(o.room)}` : ''}</span>
            <span class="tt-slot-state">${esc(OCCURRENCE_STATUS[o.status])}</span>
          </button>`;
    }

    function renderWeek() {
        const today = todayISO();
        const days = Object.keys(WEEKDAYS).map((n) => {
            const date = addDays(state.weekStart, Number(n) - 1);
            const items = weekRows.filter((o) => o.date === date);
            return `
            <section class="tt-day${date === today ? ' is-today' : ''}" aria-label="${esc(WEEKDAYS[n])} ${esc(formatDate(date))}">
              <div class="tt-day-head"><span>${esc(WEEKDAYS[n])}</span><span class="tt-day-date">${esc(shortDate(date))}</span></div>
              ${items.length ? items.map(slotButton).join('') : '<p class="tt-day-empty">Aucun cours</p>'}
            </section>`;
        }).join('');
        const end = addDays(state.weekStart, 5);
        $('content').innerHTML = `
          <div class="tt-toolbar">
            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn-table-action" data-week="-1" aria-label="Semaine précédente"><i class="bi bi-chevron-left"></i></button>
              <span class="tt-week-label">Semaine du ${esc(formatDate(state.weekStart))} au ${esc(formatDate(end))}</span>
              <button type="button" class="btn-table-action" data-week="1" aria-label="Semaine suivante"><i class="bi bi-chevron-right"></i></button>
            </div>
            <button type="button" class="btn-table-action" data-week="today">Aujourd'hui</button>
          </div>
          <div class="tt-week">${days}</div>
          ${weekRows.length ? '' : `<div class="card mt-3">${emptyState("Aucun cours cette semaine pour cette sélection. Utilisez les flèches pour changer de semaine ou ajoutez un créneau.", 'bi-calendar-x')}</div>`}`;
    }

    function actionButtons(o) {
        return `
          <div class="d-flex justify-content-center gap-1">
            <button type="button" class="table-btn-action" data-act="confirm" data-occ="${esc(o.id)}" title="Confirmer la séance" aria-label="Confirmer la séance du ${esc(formatDate(o.date))}"><i class="bi bi-check2"></i></button>
            <button type="button" class="table-btn-action" data-act="absent" data-occ="${esc(o.id)}" title="Déclarer l'absence" aria-label="Déclarer l'absence pour la séance du ${esc(formatDate(o.date))}"><i class="bi bi-person-x"></i></button>
            <button type="button" class="table-btn-action delete" data-act="cancel" data-occ="${esc(o.id)}" title="Annuler cette date" aria-label="Annuler la séance du ${esc(formatDate(o.date))}"><i class="bi bi-calendar-x"></i></button>
          </div>`;
    }

    function renderConfirm() {
        const rows = semester.filter((o) => o.status === 'toConfirm').sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
        if (!rows.length) {
            $('content').innerHTML = `<div class="card">${emptyState('Rien à confirmer : toutes les séances prévues par l\'emploi du temps sont enregistrées.', 'bi-check2-circle')}</div>`;
            return;
        }
        const page = paginate(rows, state.pageConfirm, PAGE_SIZE);
        state.pageConfirm = page.page;
        $('content').innerHTML = `
          <div class="table-card-custom">
            <div class="table-responsive"><table class="table-custom">
              <thead><tr><th>Date</th><th>Matière</th><th class="d-none d-md-table-cell">Enseignant</th><th class="d-none d-lg-table-cell">Classe · salle</th><th class="text-center">Actions</th></tr></thead>
              <tbody>${page.items.map((o) => {
                  const d = describe(o);
                  return `<tr>
                    <td><div class="table-product-name">${esc(WEEKDAYS[o.weekday])} ${esc(formatDate(o.date))}</div><div class="table-user-sub">${esc(o.startTime)} - ${esc(o.endTime)}</div></td>
                    <td><div class="table-product-name">${esc(d.name)}</div><div class="table-user-sub">${esc(d.code)}</div></td>
                    <td class="d-none d-md-table-cell">${esc(d.teacher)}</td>
                    <td class="d-none d-lg-table-cell">${esc(d.cls)}${o.room ? ` · ${esc(o.room)}` : ''}</td>
                    <td>${actionButtons(o)}</td>
                  </tr>`;
              }).join('')}</tbody>
            </table></div>
            <div id="table-footer">${paginationFooter(page, 'séances')}</div>
          </div>
          <p class="stat-hint mt-2">Confirmer enregistre la séance avec les horaires du créneau (heures réalisées). Déclarer l'absence l'enregistre comme absence. Annuler la retire sans compter d'absence (jour férié…).</p>`;
    }

    function renderSlots() {
        if (!slots.length) {
            $('content').innerHTML = `<div class="card">${emptyState("Aucun créneau pour cette sélection. Ajoutez le premier créneau de l'emploi du temps.", 'bi-calendar-week')}</div>`;
            return;
        }
        const page = paginate(slots, state.pageSlots, PAGE_SIZE);
        state.pageSlots = page.page;
        $('content').innerHTML = `
          <div class="table-card-custom">
            <div class="table-responsive"><table class="table-custom">
              <thead><tr><th>Jour</th><th>Matière</th><th class="d-none d-md-table-cell">Enseignant</th><th class="d-none d-lg-table-cell">Classe · salle</th><th class="d-none d-lg-table-cell">Période</th><th class="text-center">Actions</th></tr></thead>
              <tbody>${page.items.map((s) => {
                  const d = describe(s);
                  return `<tr data-slot="${esc(s.id)}">
                    <td><div class="table-product-name">${esc(WEEKDAYS[s.weekday])}</div><div class="table-user-sub">${esc(s.startTime)} - ${esc(s.endTime)}</div></td>
                    <td><div class="table-product-name">${esc(d.name)}</div><div class="table-user-sub">${esc(d.code)}</div></td>
                    <td class="d-none d-md-table-cell">${esc(d.teacher)}</td>
                    <td class="d-none d-lg-table-cell">${esc(d.cls)}${s.room ? ` · ${esc(s.room)}` : ''}</td>
                    <td class="d-none d-lg-table-cell">${esc(formatDate(s.validFrom))} → ${esc(formatDate(s.validUntil))}</td>
                    <td><div class="d-flex justify-content-center gap-1">
                      <button type="button" class="table-btn-action" data-slot-act="edit" title="Modifier" aria-label="Modifier le créneau ${esc(d.code)} du ${esc(WEEKDAYS[s.weekday].toLowerCase())}"><i class="bi bi-pencil"></i></button>
                      <button type="button" class="table-btn-action delete" data-slot-act="delete" title="Supprimer" aria-label="Supprimer le créneau ${esc(d.code)} du ${esc(WEEKDAYS[s.weekday].toLowerCase())}"><i class="bi bi-trash"></i></button>
                    </div></td>
                  </tr>`;
              }).join('')}</tbody>
            </table></div>
            <div id="table-footer">${paginationFooter(page, 'créneaux')}</div>
          </div>`;
    }

    function render() {
        renderKpis();
        renderTabs();
        if (state.tab === 'week') renderWeek();
        else if (state.tab === 'confirm') renderConfirm();
        else renderSlots();
    }

    // ---- Chargement --------------------------------------------------------------------------------
    async function load() {
        const mine = ++run;
        try {
            const [sem, list, week] = await Promise.all([
                TimetableService.occurrences({ from: sinceStart(), to: todayISO(), ...filters() }),
                TimetableService.slots(filters()),
                TimetableService.occurrences({ from: state.weekStart, to: addDays(state.weekStart, 6), ...filters() }),
            ]);
            if (mine !== run) return; // une réponse plus récente est déjà arrivée
            semester = sem;
            slots = list;
            weekRows = week;
            render();
        } catch (error) {
            console.error(error);
            if (mine === run) $('content').innerHTML = errorState();
        }
    }

    // ---- Actions sur une occurrence ----------------------------------------------------------------
    const findOccurrence = (id) => [...weekRows, ...semester].find((o) => o.id === id);
    const fail = (error) => toast(error instanceof ValidationError ? error.message : "L'opération a échoué. Réessayez.", { type: 'danger' });

    async function confirmOccurrence(o) {
        try {
            await TimetableService.confirm({ slotId: o.slotId, date: o.date }, actor);
            toast(`Séance du ${formatDate(o.date)} confirmée.`);
            await load();
        } catch (error) { fail(error); }
    }

    async function absentOccurrence(o) {
        const saved = await openFormModal({
            title: 'Déclarer une absence',
            submitLabel: "Enregistrer l'absence",
            body: `<p class="mb-3">${esc(describe(o).name)} · ${esc(describe(o).teacher)}, le ${esc(formatDate(o.date))} (${esc(o.startTime)}-${esc(o.endTime)}).</p>
                   <div class="row">${inputField({ label: "Motif de l'absence (facultatif)", name: 'note', col: 'col-12', attrs: 'maxlength="200"', placeholder: 'Ex. maladie, mission…' })}</div>`,
            onSubmit: (values) => TimetableService.markAbsent({ slotId: o.slotId, date: o.date, note: values.note }, actor),
        });
        if (saved) { toast(`Absence enregistrée le ${formatDate(o.date)}.`); await load(); }
    }

    async function cancelOccurrence(o) {
        const saved = await openFormModal({
            title: 'Annuler cette séance',
            submitLabel: 'Annuler la séance',
            body: `<p class="mb-3">${esc(describe(o).name)}, le ${esc(formatDate(o.date))} (${esc(o.startTime)}-${esc(o.endTime)}) : aucune séance ni absence ne sera comptée.</p>
                   <div class="row">${inputField({ label: 'Motif (facultatif)', name: 'reason', col: 'col-12', attrs: 'maxlength="120"', placeholder: 'Ex. jour férié, salle indisponible…' })}</div>`,
            onSubmit: (values) => TimetableService.cancel({ slotId: o.slotId, date: o.date, reason: values.reason }, actor),
        });
        if (saved) { toast('Séance annulée.'); await load(); }
    }

    async function restoreOccurrence(o) {
        try {
            await TimetableService.restore({ slotId: o.slotId, date: o.date }, actor);
            toast('Séance rétablie.');
            await load();
        } catch (error) { fail(error); }
    }

    /** Fiche d'une occurrence, avec les actions qui conviennent à son statut. */
    async function openOccurrence(o) {
        const d = describe(o);
        const body = `
          <span class="badge-table ${STATUS_BADGE[o.status]}">${esc(OCCURRENCE_STATUS[o.status])}</span>
          <h3 class="event-detail-title mt-2">${esc(d.name)}</h3>
          <dl class="tt-detail mb-0">
            <dt>Date</dt><dd>${esc(WEEKDAYS[o.weekday])} ${esc(formatDateLong(o.date))}, ${esc(o.startTime)} - ${esc(o.endTime)}</dd>
            <dt>Matière</dt><dd>${esc(d.code)}</dd>
            <dt>Enseignant</dt><dd>${esc(d.teacher)}</dd>
            <dt>Classe</dt><dd>${esc(d.cls)}</dd>
            ${o.room ? `<dt>Salle</dt><dd>${esc(o.room)}</dd>` : ''}
            ${o.reason ? `<dt>Motif de l'annulation</dt><dd>${esc(o.reason)}</dd>` : ''}
          </dl>`;
        const buttons = [];
        if (o.status === 'toConfirm') buttons.push({ id: 'confirm', label: 'Confirmer la séance', className: 'btn-custom-primary' }, { id: 'absent', label: 'Déclarer l\'absence' });
        if (o.status === 'toConfirm' || o.status === 'upcoming') buttons.push({ id: 'cancel', label: 'Annuler cette date' });
        if (o.status === 'cancelled') buttons.push({ id: 'restore', label: 'Rétablir', className: 'btn-custom-primary' });
        buttons.push({ id: 'edit', label: 'Modifier le créneau' });
        const action = await openModal({ title: 'Séance prévue', body, buttons });
        if (action === 'confirm') await confirmOccurrence(o);
        else if (action === 'absent') await absentOccurrence(o);
        else if (action === 'cancel') await cancelOccurrence(o);
        else if (action === 'restore') await restoreOccurrence(o);
        else if (action === 'edit') await editSlot(o.slotId);
    }

    async function editSlot(slotId) {
        const slot = slots.find((s) => s.id === slotId) ?? await TimetableService.slot(slotId);
        if (!slot) return;
        if (await openSlotForm({ slot, actor })) await load();
    }

    async function addSlot() {
        if (await openSlotForm({ actor, defaults: { teacherId: state.teacherId } })) await load();
    }

    // ---- Événements --------------------------------------------------------------------------------
    $('btn-add-slot').addEventListener('click', addSlot);
    $('filter-teacher').addEventListener('change', (e) => { state.teacherId = e.target.value; state.pageConfirm = 1; state.pageSlots = 1; load(); });
    $('filter-class').addEventListener('change', (e) => { state.levelId = e.target.value; state.pageConfirm = 1; state.pageSlots = 1; load(); });
    $('tabs').addEventListener('click', (e) => {
        const button = e.target.closest('[data-tab]');
        if (!button || button.dataset.tab === state.tab) return;
        state.tab = button.dataset.tab;
        render();
    });
    $('content').addEventListener('click', async (e) => {
        const week = e.target.closest('[data-week]');
        if (week) {
            const step = week.dataset.week;
            state.weekStart = step === 'today' ? mondayOf(todayISO()) : addDays(state.weekStart, 7 * Number(step));
            await load();
            return;
        }
        const page = e.target.closest('[data-page]');
        if (page) {
            e.preventDefault();
            if (state.tab === 'confirm') state.pageConfirm = Number(page.dataset.page); else state.pageSlots = Number(page.dataset.page);
            render();
            return;
        }
        const act = e.target.closest('[data-act]');
        if (act) {
            const o = findOccurrence(act.dataset.occ);
            if (!o) return;
            if (act.dataset.act === 'confirm') await confirmOccurrence(o);
            else if (act.dataset.act === 'absent') await absentOccurrence(o);
            else await cancelOccurrence(o);
            return;
        }
        const slotAct = e.target.closest('[data-slot-act]');
        if (slotAct) {
            const slot = slots.find((s) => s.id === slotAct.closest('tr').dataset.slot);
            if (!slot) return;
            if (slotAct.dataset.slotAct === 'edit') await editSlot(slot.id);
            else if (await confirmDeleteSlot(slot, `${describe(slot).code} · ${describe(slot).name}`, actor)) await load();
            return;
        }
        const card = e.target.closest('[data-occ]');
        if (card) {
            const o = findOccurrence(card.dataset.occ);
            if (o) await openOccurrence(o);
        }
    });

    mountExportMenu($('export-menu'), {
        getSpec() {
            if (!slots.length) return null;
            return {
                filename: 'emploi-du-temps',
                sheets: [{
                    name: 'Emploi du temps',
                    title: `Emploi du temps ${config.ACADEMIC_YEAR}`,
                    subtitle: exportInfo({
                        summary: `${formatNumber(slots.length)} créneau${slots.length > 1 ? 'x' : ''} hebdomadaire${slots.length > 1 ? 's' : ''}`,
                        filters: describeFilters([['Enseignant', $('filter-teacher')], ['Classe', $('filter-class')]]),
                    }),
                    columns: [
                        { header: 'Jour', width: 12 }, { header: 'Début', width: 9, align: 'center' }, { header: 'Fin', width: 9, align: 'center' },
                        { header: 'Code', width: 11 }, { header: 'Matière', width: 36 }, { header: 'Enseignant', width: 26 },
                        { header: 'Classe', width: 12, align: 'center' }, { header: 'Salle', width: 16 },
                        { header: 'Du', type: 'date', width: 13 }, { header: 'Au', type: 'date', width: 13 },
                    ],
                    rows: slots.map((s) => {
                        const d = describe(s);
                        return [WEEKDAYS[s.weekday], s.startTime, s.endTime, d.code, d.name, d.teacher, d.cls, s.room ?? '', s.validFrom, s.validUntil];
                    }),
                }],
            };
        },
    });

    // ---- Démarrage ---------------------------------------------------------------------------------
    try {
        const [teachers, subjects, classes] = await Promise.all([TeacherService.list(), SubjectService.list(), ReferenceService.classes()]);
        teacherById = new Map(teachers.map((t) => [t.id, t]));
        subjectById = new Map(subjects.map((s) => [s.id, s]));
        classById = new Map(classes.map((c) => [c.id, c]));
        $('filter-teacher').innerHTML = '<option value="">Tous les enseignants</option>' +
            [...teachers].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr')).map((t) => `<option value="${esc(t.id)}">${esc(fullName(t))}</option>`).join('');
        $('filter-class').innerHTML = '<option value="">Toutes les classes</option>' +
            classes.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');

        // Semaine affichée au départ : celle d'aujourd'hui, ou la dernière semaine de cours si rien n'est prévu cette semaine
        const thisWeek = mondayOf(todayISO());
        const past = await TimetableService.occurrences({ from: sinceStart(), to: todayISO() });
        const inWeek = past.some((o) => o.date >= thisWeek) || (await TimetableService.occurrences({ from: thisWeek, to: addDays(thisWeek, 6) })).length > 0;
        const last = past.at(-1);
        state.weekStart = inWeek || !last ? thisWeek : mondayOf(last.date);
        state.tab = past.some((o) => o.status === 'toConfirm') ? 'confirm' : 'week';

        await load();
        const params = new URLSearchParams(window.location.search);
        if (params.has('new')) {
            window.history.replaceState(null, '', window.location.pathname);
            addSlot();
        }
    } catch (error) {
        console.error(error);
        $('content').innerHTML = errorState();
    }
}
