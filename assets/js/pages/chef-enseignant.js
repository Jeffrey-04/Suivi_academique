/*
 * Chef : fiche d'un enseignant (?id=tea-001) : identité, bilan d'heures du semestre, matières attribuées,
 * puis heures / présence / séances sur la période choisie (sélecteur de l'en-tête).
 */

import { config, url } from '../config.js';
import { initPage } from '../layout.js';
import { confirmDeleteTeacher, openTeacherForm } from '../components/teacher-form.js';
import { HoursService, SessionService, StatsService, TeacherService } from '../services/index.js';
import { trend } from '../utils/calculs.js';
import { cardSparkline } from '../utils/charts.js';
import { queueToast } from '../utils/dialogs.js';
import { esc, formatDate, formatHours, formatNumber, fullName, todayISO } from '../utils/format.js';
import { initPeriodPicker } from '../utils/period.js';
import {
    activityList, describeTrend, emptyState, errorState, promoCard, renderInto, sinceWeeks, statCard, trendCard,
} from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const listUrl = url('pages/chef/enseignants.html');

const ctx = await initPage({ role: 'chef', page: 'teachers' });

function profileCard(teacher, subjectCount) {
    const fact = (label, value) => `<div class="profile-fact"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
    return `
      <div class="card profile-card">
        <div class="profile-head">
          <img src="${esc(url(teacher.photo))}" alt="" class="profile-avatar js-avatar">
          <div>
            <h2 class="profile-name">${esc(fullName(teacher))}</h2>
            <div class="profile-role">${esc(teacher.grade)}</div>
          </div>
        </div>
        <dl class="profile-facts">
          ${fact('Adresse e-mail', `<a href="mailto:${esc(teacher.email)}">${esc(teacher.email)}</a>`)}
          ${fact('Téléphone', teacher.phone ? `<a href="tel:${esc(teacher.phone.replace(/\s/g, ''))}">${esc(teacher.phone)}</a>` : '—')}
          ${fact('Volume horaire dû', `${formatNumber(teacher.contractHours)} h par semestre`)}
          ${fact('Matières attribuées', formatNumber(subjectCount))}
        </dl>
      </div>`;
}

function subjectsTable(rows) {
    if (!rows.length) return emptyState("Aucune matière n'est attribuée à cet enseignant.", 'bi-book');
    const body = rows.map((r) => `
        <tr>
          <td><div class="table-product-name">${esc(r.subject.name)}</div><div class="table-user-sub">${esc(r.subject.code)}</div></td>
          <td>${esc(r.className)}</td>
          <td>${esc(r.subject.coefficient)}</td>
          <td>${formatNumber(r.subject.plannedHours)} h</td>
          <td><span class="badge-table ${r.validated === r.entered ? 'success' : 'pending'}">${formatNumber(r.validated)} / ${formatNumber(r.entered)} validées</span></td>
          <td>${r.cc === null ? '—' : formatNumber(r.cc, 2)}</td>
          <td>${r.exam === null ? '—' : formatNumber(r.exam, 2)}</td>
        </tr>`).join('');
    return `
      <div class="table-responsive">
        <table class="table-custom">
          <thead><tr><th>Matière</th><th>Classe</th><th title="Coefficient">Coef.</th><th>Heures prévues</th><th>Notes</th><th title="Moyenne du contrôle continu">Moy. CC</th><th>Moy. examen</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
}

if (ctx) {
    const id = new URLSearchParams(window.location.search).get('id');
    let teacher = null;
    let range = { from: config.SEMESTER_START, to: todayISO() };
    let run = 0;
    let periodCharts = [];
    let pickerReady = false;

    function loadPeriod() {
        const mine = ++run;
        const isCurrent = () => mine === run;
        periodCharts.forEach((chart) => chart.destroy());
        periodCharts = [];
        const params = { ...range, teacherId: teacher.id };

        renderInto(
            $('period-cards'),
            async () => {
                const [weekly, stats] = await Promise.all([StatsService.teachingWeekly(params), SessionService.stats(params)]);
                const since = sinceWeeks(trend(weekly.map((w) => w.hours)).window);
                const hours = trend(weekly.map((w) => w.hours));
                const rate = trend(weekly.map((w) => w.rate), { mode: 'avg' });
                return [
                    {
                        id: 'hours', label: 'Heures réalisées', icon: 'bi-clock-history', col: 'h-100', value: `${formatNumber(stats.hours)} h`,
                        hint: `sur ${formatNumber(stats.scheduledHours)} h programmées`,
                        trend: describeTrend({ direction: hours.direction, value: hours.change, since }),
                        series: weekly.map((w) => w.hours), format: (v) => `${formatNumber(v, 1)} h`,
                    },
                    {
                        id: 'presence', label: 'Présence', icon: 'bi-person-check', col: 'h-100', value: stats.rate === null ? '—' : `${formatNumber(stats.rate, 1)} %`,
                        hint: `${formatNumber(stats.absent)} absence(s) sur ${formatNumber(stats.total)} séances`,
                        trend: describeTrend({ direction: rate.direction, value: rate.delta, unit: 'pt', since }),
                        series: weekly.map((w) => w.rate), format: (v) => `${formatNumber(v, 1)} %`,
                    },
                ];
            },
            (cards) => cards.map((c) => `<div class="col-sm-6">${trendCard(c)}</div>`).join(''),
            isCurrent,
        ).then((cards) => {
            cards?.forEach((card) => periodCharts.push(cardSparkline(card)));
        }).catch(console.error);

        renderInto(
            $('recent-sessions'),
            () => StatsService.recentSessions(teacher.id, 8, range),
            (sessions) => activityList(
                sessions.map((s) => ({
                    icon: s.status === 'present' ? 'bi-check-circle' : 'bi-person-x',
                    title: s.subject.name,
                    subtitle: `${formatDate(s.date)} · ${s.startTime}–${s.endTime}${s.status === 'absent' && s.note ? ` · ${s.note}` : ''}`,
                    amount: `${s.status === 'present' ? '+' : '−'}${formatHours(s.hours)}`,
                    amountClass: s.status === 'present' ? 'text-success' : 'text-danger',
                })),
                'Aucune séance sur cette période.',
            ),
            isCurrent,
        );
    }

    async function load() {
        try {
            teacher = id ? await TeacherService.get(id) : null;
            if (!teacher) {
                $('page-title').textContent = 'Enseignant introuvable';
                $('page-actions').hidden = true;
                $('content').innerHTML = `<div class="card">${emptyState("Cet enseignant n'existe pas ou a été supprimé.", 'bi-person-x')}<div class="text-center"><a class="btn-custom btn-custom-primary" href="${esc(listUrl)}">Retour à la liste</a></div></div>`;
                return;
            }
            const [overview, hours] = await Promise.all([StatsService.teacherOverview(teacher.id), HoursService.summary(teacher.id)]);
            document.title = `${fullName(teacher)} - Enseignants - Suivi Académique`;
            $('page-title').textContent = fullName(teacher);
            $('page-subtitle').textContent = `${teacher.grade} · semestre ${config.CURRENT_SEMESTER} ${config.ACADEMIC_YEAR}`;
            $('page-actions').hidden = false;

            const balance = hours.overtime
                ? { title: `${formatNumber(hours.overtime)} h supplémentaires.`, desc: `Au-delà du volume dû de ${formatNumber(hours.contract)} h pour le semestre.` }
                : hours.missing
                    ? { title: `${formatNumber(hours.missing)} h non réalisées.`, desc: `Sur ${formatNumber(hours.planned)} h prévues dans ses matières (absences, séances non tenues).` }
                    : { title: 'Heures complètes.', desc: 'Toutes les heures prévues ont été réalisées.' };

            $('content').innerHTML = `
              <div class="row g-4">
                <div class="col-xl-4">
                  ${profileCard(teacher, overview.rows.length)}
                  ${promoCard(balance)}
                </div>
                <div class="col-xl-8">
                  <h2 class="section-title">Bilan du semestre</h2>
                  <div class="row g-4 mb-3">
                    ${statCard({ label: 'Heures prévues', value: `${formatNumber(hours.planned)} h`, icon: 'bi-calendar-week', hint: 'Dans ses matières', col: 'col-6' })}
                    ${statCard({ label: 'Heures réalisées', value: `${formatNumber(hours.done)} h`, icon: 'bi-clock-history', hint: `Dues : ${formatNumber(hours.contract)} h`, col: 'col-6' })}
                    ${statCard({ label: 'Heures sup.', value: `${formatNumber(hours.overtime)} h`, icon: 'bi-plus-circle', hint: 'Au-delà du volume dû', col: 'col-6' })}
                    ${statCard({ label: 'Manquantes', value: `${formatNumber(hours.missing)} h`, icon: 'bi-dash-circle', hint: 'Prévues non réalisées', col: 'col-6' })}
                  </div>
                  <h2 class="section-title">Sur la période choisie</h2>
                  <div class="row g-4 mb-3" id="period-cards"></div>
                </div>
                <div class="col-12">
                  <div class="card p-0 mb-0">
                    <div class="p-4 pb-3"><h3 class="card-title">Matières attribuées</h3></div>
                    ${subjectsTable(overview.rows)}
                  </div>
                </div>
                <div class="col-12">
                  <div class="card mb-0">
                    <div class="card-header"><h3 class="card-title">Séances de la période</h3></div>
                    <div id="recent-sessions"></div>
                  </div>
                </div>
              </div>`;

            if (!pickerReady) {
                pickerReady = true;
                initPeriodPicker({
                    start: range.from, end: range.to, min: config.SEMESTER_START, max: todayISO(),
                    onChange: (next) => { range = next; loadPeriod(); },
                });
            }
            loadPeriod();
        } catch (error) {
            console.error(error);
            $('content').innerHTML = errorState();
        }
    }

    $('btn-edit').addEventListener('click', async () => {
        if (await openTeacherForm(teacher)) await load();
    });
    $('btn-delete').addEventListener('click', async () => {
        if (await confirmDeleteTeacher(teacher, { silent: true })) {
            queueToast(`${fullName(teacher)} a été supprimé.`);
            window.location.href = listUrl;
        }
    });

    await load();
}
