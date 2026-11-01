/*
 * Relevé de notes affiché à l'écran : une « feuille A4 » identique au PDF (voir utils/bulletin-pdf.js).
 * Les textes et valeurs viennent de utils/transcript.js, commun aux deux ; seule la mise en page est dupliquée,
 * toute modification de l'une doit être reportée sur l'autre.
 * `doc` = document retourné par BulletinService.getDocument().
 */

import { esc } from '../utils/format.js';
import { transcriptModel } from '../utils/transcript.js';

const EMBLEM = `
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="50" fill="#072F1F"/>
    <g transform="translate(50,50)" stroke="#B4F105" stroke-width="9" stroke-linecap="round">
      <line x1="0" y1="-26" x2="0" y2="26"/><line x1="0" y1="-26" x2="0" y2="26" transform="rotate(60)"/><line x1="0" y1="-26" x2="0" y2="26" transform="rotate(120)"/>
    </g>
  </svg>`;

const authority = (m, lang) => `
  <div class="transcript-authority">
    <strong>${esc(m.republic[lang].name)}</strong>
    <em>${esc(m.republic[lang].motto)}</em>
    <strong>${esc(m.university[lang])}</strong>
  </div>`;

const identityRows = (rows) => rows.map((r) => `
  <div class="transcript-field"><dt>${esc(r.fr)} / ${esc(r.en)} :</dt><dd>${esc(r.value)}</dd></div>`).join('');

function tableRows(m) {
    return m.groups.map((g) => `
      <tr class="is-unit"><td>${esc(g.unit.code)}</td><td>${esc(g.unit.title)}</td><td>${esc(g.unit.mark)}</td><td>${esc(g.unit.credits)}</td><td></td><td></td></tr>
      ${g.lines.map((l) => `
      <tr><td>${esc(l.code)}</td><td class="is-course">${esc(l.title)}</td><td${l.low ? ' class="is-low"' : ''}>${esc(l.mark)}</td><td>${esc(l.credits)}</td><td>${esc(l.year)}</td><td>${esc(l.semester)}</td></tr>`).join('')}`).join('');
}

/** HTML de la feuille de relevé. */
export function renderBulletinSheet(doc) {
    const m = transcriptModel(doc);
    return `
    <article class="transcript-sheet" aria-label="Relevé de notes de ${esc(doc.student.firstName)} ${esc(doc.student.lastName)}">
      <div class="transcript-watermark${m.outdated ? ' is-outdated' : ''}" aria-hidden="true">${m.outdated ? 'NON À JOUR' : 'ORIGINAL'}</div>

      <header class="transcript-head">
        ${authority(m, 'fr')}
        <div class="transcript-emblem">${EMBLEM}</div>
        ${authority(m, 'en')}
      </header>

      <h2 class="transcript-title">${esc(m.title.fr)} / ${esc(m.title.en)} N° ${esc(m.number)}</h2>
      <p class="transcript-semester">${esc(m.semesterLine.fr)} / ${esc(m.semesterLine.en)}</p>

      <p class="transcript-establishment"><span>ÉTABLISSEMENT :</span> ${esc(m.faculty.fr)}<br><span>FACULTY / SCHOOL :</span> ${esc(m.faculty.en)}</p>

      <section class="transcript-identity">
        <div class="transcript-name"><span>${esc(m.identity.name.fr)} / ${esc(m.identity.name.en)} :</span> <strong>${esc(m.identity.name.value)}</strong></div>
        <dl class="transcript-columns">
          <div>${identityRows(m.identity.left)}</div>
          <div>${identityRows(m.identity.right)}</div>
        </dl>
      </section>

      <table class="transcript-table">
        <thead><tr>${m.columns.map((c) => `<th class="${c.align === 'left' ? 'is-left' : ''}">${esc(c.fr)}<em>${esc(c.en)}</em></th>`).join('')}</tr></thead>
        <tbody>${tableRows(m)}</tbody>
      </table>

      <table class="transcript-summary">
        <thead><tr>${m.summary.map((c) => `<th>${esc(c.fr)}<em>${esc(c.en)}</em></th>`).join('')}</tr></thead>
        <tbody><tr>${m.summary.map((c) => `<td class="${c.tone ? `is-${c.tone}` : ''}"><strong>${esc(c.value)}</strong>${c.note ? `<em>${esc(c.note)}</em>` : ''}</td>`).join('')}</tr></tbody>
      </table>

      <section class="transcript-remarks">
        <h3>Observations du jury / Jury remarks :</h3>
        <p class="transcript-rank">Classement / Rank : ${esc(m.remarks.rank)} &nbsp;·&nbsp; Moyenne de la classe / Class average : ${esc(m.remarks.classAverage)}${m.remarks.unranked ? ` &nbsp;(${esc(m.remarks.unranked)})` : ''}</p>
        <p class="transcript-appreciation">${esc(m.remarks.appreciation)}</p>
      </section>

      <p class="transcript-issued">Délivré le / Issued on : ${esc(m.issuedOn)}</p>
      <section class="transcript-signatures">
        ${m.signatures.map((s) => `
        <div><strong>${esc(s.fr)}</strong><em>${esc(s.en)}</em><div class="transcript-sign-line"></div><span>${esc(s.name)}</span></div>`).join('')}
      </section>

      <p class="transcript-notice">${esc(m.notice.fr)} / ${esc(m.notice.en)}</p>
      <footer class="transcript-pagefoot">
        <span>${esc(doc.appName)} · ${esc(doc.department)}</span>
        <span>Relevé ${esc(m.number)} · généré le ${esc(m.issuedOn)}</span>
        <span>Page 1 / 1</span>
      </footer>
    </article>`;
}

/**
 * Affiche la feuille dans un conteneur et l'adapte à la largeur disponible (la feuille fait 794 px, soit 21 cm) :
 * sur petit écran elle est réduite plutôt que tronquée. Retourne une fonction pour arrêter l'observation.
 */
export function mountBulletinSheet(container, doc) {
    container.innerHTML = `<div class="transcript-stage">${renderBulletinSheet(doc)}</div>`;
    const sheet = container.querySelector('.transcript-sheet');
    const SHEET_WIDTH = 794;
    const fit = () => { sheet.style.zoom = String(Math.min(1, container.clientWidth / SHEET_WIDTH)); };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
}
