/*
 * Chef : fiche d'un étudiant (?id=stu-001) : identité, moyennes, résultats par matière, état du bulletin.
 * Modification et suppression depuis la fiche ; la suppression ramène à la liste.
 */

import { url } from '../config.js';
import { initPage } from '../layout.js';
import { averageCard, subjectsCard } from '../components/student-kpis.js';
import { confirmDeleteStudent, openStudentForm } from '../components/student-form.js';
import { StatsService } from '../services/index.js';
import { CHART_COLORS, cardSparkline, groupedBars } from '../utils/charts.js';
import { queueToast } from '../utils/dialogs.js';
import { ageOf, esc, formatDate, formatDateLong, formatNumber, fullName } from '../utils/format.js';
import { emptyState, errorState, promoCard, subjectTable, trendCard } from '../utils/ui.js';

const $ = (id) => document.getElementById(id);
const listUrl = url('pages/chef/etudiants.html');

const ctx = await initPage({ role: 'chef', page: 'students' });

function profileCard({ student, className, bulletin }) {
    const fact = (label, value) => `<div class="profile-fact"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
    return `
      <div class="card profile-card">
        <div class="profile-head">
          <img src="${esc(url(student.photo))}" alt="" class="profile-avatar js-avatar">
          <div>
            <h2 class="profile-name">${esc(fullName(student))}</h2>
            <div class="profile-role">${esc(className)}</div>
          </div>
        </div>
        <dl class="profile-facts">
          ${fact('Matricule', `<span class="badge-table success">${esc(student.matricule)}</span>`)}
          ${fact('Adresse e-mail', `<a href="mailto:${esc(student.email)}">${esc(student.email)}</a>`)}
          ${fact('Téléphone', student.phone ? `<a href="tel:${esc(student.phone.replace(/\s/g, ''))}">${esc(student.phone)}</a>` : '—')}
          ${fact('Naissance', `${esc(formatDateLong(student.birthDate))}${student.birthPlace ? ` à ${esc(student.birthPlace)}` : ''} <span class="text-muted-green">(${ageOf(student.birthDate)} ans)</span>`)}
          ${fact('Bulletin', bulletin ? `<span class="badge-table success">Généré le ${esc(formatDate(bulletin.generatedAt))}</span>` : '<span class="badge-table pending">Pas encore généré</span>')}
        </dl>
      </div>`;
}

function render(overview) {
    const { student, report } = overview;
    document.title = `${fullName(student)} - Étudiants - Suivi Académique`;
    $('page-title').textContent = fullName(student);
    $('page-subtitle').textContent = `Matricule ${student.matricule} · ${overview.className}`;
    $('page-actions').hidden = false;

    const average = averageCard(overview);
    const subjects = subjectsCard(overview);
    $('content').innerHTML = `
      <div class="row g-4">
        <div class="col-xl-4">
          ${profileCard(overview)}
          ${promoCard(overview.bulletin
            ? { title: 'Bulletin du semestre disponible.', desc: `Moyenne ${formatNumber(overview.bulletin.average, 2)} / 20 · ${overview.bulletin.result}.`, button: { label: 'Consulter le bulletin', href: `${url('pages/chef/bulletin.html')}?student=${encodeURIComponent(student.id)}` } }
            : { title: 'Bulletin non généré.', desc: report.complete ? 'Les notes sont complètes : il peut être généré.' : 'Des notes sont manquantes ou pas encore validées.', button: { label: report.complete ? 'Aller générer le bulletin' : 'Voir les matières manquantes', href: `${url('pages/chef/bulletin.html')}?student=${encodeURIComponent(student.id)}` } })}
        </div>
        <div class="col-xl-8">
          <div class="row g-4 mb-4">
            <div class="col-sm-6">${trendCard(average)}</div>
            <div class="col-sm-6">${trendCard(subjects)}</div>
          </div>
          <div class="card">
            <div class="card-header mb-2">
              <h3 class="card-title">Moyennes par matière</h3>
              <div class="d-flex gap-3 align-items-center">
                <div class="chart-legend-item"><span class="legend-dot bg-forest-medium"></span><span class="chart-legend-label">Étudiant</span></div>
                <div class="chart-legend-item"><span class="legend-dot bg-lime-accent"></span><span class="chart-legend-label">Moyenne de la classe</span></div>
              </div>
            </div>
            <p class="stat-hint mb-3">Notes validées, sur 20.</p>
            <div id="subject-chart"></div>
          </div>
        </div>
        <div class="col-12">
          <div class="card p-0 mb-0">
            <div class="p-4 pb-3"><h3 class="card-title">Détail par matière</h3></div>
            ${subjectTable(report.lines)}
          </div>
        </div>
      </div>`;

    cardSparkline(average);
    cardSparkline(subjects);
    groupedBars('#subject-chart', {
        categories: report.lines.map((l) => l.code),
        series: [{ name: 'Étudiant', data: report.lines.map((l) => l.average) }, { name: 'Moyenne de la classe', data: report.lines.map((l) => l.classAverage) }],
        colors: [CHART_COLORS.forest, CHART_COLORS.lime],
        max: 20,
        format: (v) => `${formatNumber(v, 2)} / 20`,
    });
}

if (ctx) {
    const id = new URLSearchParams(window.location.search).get('id');
    let overview = null;

    async function load() {
        try {
            overview = id ? await StatsService.studentOverview(id) : null;
            if (!overview) {
                $('page-title').textContent = 'Étudiant introuvable';
                $('content').innerHTML = `<div class="card">${emptyState("Cet étudiant n'existe pas ou a été supprimé.", 'bi-person-x')}<div class="text-center"><a class="btn-custom btn-custom-primary" href="${esc(listUrl)}">Retour à la liste</a></div></div>`;
                return;
            }
            render(overview);
        } catch (error) {
            console.error(error);
            $('content').innerHTML = errorState();
        }
    }

    $('btn-edit').addEventListener('click', async () => {
        if (await openStudentForm(overview.student)) await load();
    });
    $('btn-delete').addEventListener('click', async () => {
        if (await confirmDeleteStudent(overview.student, { silent: true })) {
            queueToast(`${fullName(overview.student)} a été supprimé.`);
            window.location.href = listUrl;
        }
    });

    await load();
}
