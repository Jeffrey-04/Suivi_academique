/*
 * Relevé de notes en PDF (A4 portrait), au format usuel des universités camerounaises (voir transcript.js),
 * généré dans le navigateur avec jsPDF.
 *
 * Un document = un objet retourné par BulletinService.getDocument(). Plusieurs documents = un PDF groupé
 * (une page par relevé). La mise en page reproduit celle de components/bulletin-view.js (aperçu à l'écran) ;
 * les textes et valeurs viennent de transcript.js, commun aux deux.
 *
 * Polices Helvetica et Times intégrées au PDF (alphabet latin, accents français compris) : les caractères hors
 * de ce jeu (≥, →, guillemets typographiques…) sont remplacés par des équivalents par t().
 */

import { downloadBlob } from './exporter.js';
import { formatDate, fullName, todayISO } from './format.js';
import { loadJsPdf } from './loader.js';
import { transcriptModel } from './transcript.js';

const W = 595.28;
const H = 841.89;
const M = 34;
const CW = W - 2 * M;

const INK = [17, 17, 17];
const MUTED = [90, 98, 94];
const LINE = [40, 40, 40];
const GRAY = [240, 241, 240];
const FOREST = [7, 47, 31];
const LIME = [180, 241, 5];
const RED = [185, 28, 28];
const GREEN = [21, 128, 61];
const ORANGE = [194, 65, 12];

/** Texte compatible avec les polices intégrées. */
export function t(value) {
    return String(value ?? '')
        .replace(/[  ]/g, ' ')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...')
        .replace(/≥/g, '>=')
        .replace(/→/g, '->');
}

/** Nom de fichier sûr : Bulletin_S1_2026-2027_NOM_Prenom.pdf */
export function bulletinFileName(doc) {
    const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `Bulletin_${doc.semester}_${doc.academicYear}_${ascii(doc.student.lastName).toUpperCase()}_${ascii(doc.student.firstName)}.pdf`;
}

// ---- Primitives ----------------------------------------------------------------------------------

/** Écrit un texte avec police, style, taille, couleur ; retourne la largeur. */
function put(pdf, text, x, y, { font = 'helvetica', style = 'normal', size = 9, color = INK, align = 'left' } = {}) {
    pdf.setFont(font, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(t(text), x, y, { align });
    return pdf.getTextWidth(t(text));
}

/** Largeur d'un texte dans une police donnée. */
function widthOf(pdf, text, { font = 'helvetica', style = 'normal', size = 9 } = {}) {
    pdf.setFont(font, style);
    pdf.setFontSize(size);
    return pdf.getTextWidth(t(text));
}

/** Réduit la taille puis tronque (...) pour tenir dans maxWidth. */
function fitText(pdf, text, maxWidth, opts, minSize = 6.5) {
    let size = opts.size;
    while (widthOf(pdf, text, { ...opts, size }) > maxWidth && size > minSize) size -= 0.25;
    if (widthOf(pdf, text, { ...opts, size }) <= maxWidth) return { text, size };
    let cut = text;
    while (cut.length > 1 && widthOf(pdf, `${cut}...`, { ...opts, size }) > maxWidth) cut = cut.slice(0, -1);
    return { text: `${cut.trimEnd()}...`, size };
}

/** Passe à la ligne selon la police indiquée. */
function wrap(pdf, text, maxWidth, opts) {
    pdf.setFont(opts.font ?? 'helvetica', opts.style ?? 'normal');
    pdf.setFontSize(opts.size ?? 9);
    return pdf.splitTextToSize(t(text), maxWidth);
}

// ---- Éléments de page ----------------------------------------------------------------------------

function drawWatermark(pdf, label, color) {
    const angle = 52;
    const rad = (angle * Math.PI) / 180;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(112);
    pdf.setTextColor(...color);
    const w = pdf.getTextWidth(label);
    pdf.text(label, W / 2 - (w / 2) * Math.cos(rad), H / 2 + 40 + (w / 2) * Math.sin(rad), { angle });
}

function drawEmblem(pdf, cx, cy, r) {
    pdf.setFillColor(...FOREST);
    pdf.circle(cx, cy, r, 'F');
    pdf.setDrawColor(...LIME);
    pdf.setLineWidth(4.2);
    pdf.setLineCap('round');
    const arm = r * 0.52;
    [90, 30, 150].forEach((deg) => {
        const a = (deg * Math.PI) / 180;
        pdf.line(cx - arm * Math.cos(a), cy + arm * Math.sin(a), cx + arm * Math.cos(a), cy - arm * Math.sin(a));
    });
    pdf.setLineCap('butt');
}

/** Bloc d'en-tête centré (pays, devise, université). */
function drawAuthority(pdf, cx, colW, lang, m) {
    const country = m.republic[lang];
    let y = 52;
    const name = fitText(pdf, country.name, colW, { style: 'bold', size: 9.5 });
    put(pdf, name.text, cx, y, { style: 'bold', size: name.size, align: 'center' });
    y += 12;
    put(pdf, country.motto, cx, y, { font: 'times', style: 'italic', size: 8.5, align: 'center', color: MUTED });
    y += 15;
    const uni = fitText(pdf, m.university[lang], colW, { style: 'bold', size: 9 });
    put(pdf, uni.text, cx, y, { style: 'bold', size: uni.size, align: 'center' });
}

function drawHeader(pdf, m) {
    const colW = 214;
    drawAuthority(pdf, M + colW / 2, colW, 'fr', m);
    drawAuthority(pdf, W - M - colW / 2, colW, 'en', m);
    drawEmblem(pdf, W / 2, 60, 27);

    put(pdf, `${m.title.fr} / ${m.title.en} N° ${m.number}`, W / 2, 124, { style: 'bold', size: 13.5, align: 'center' });
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.8);
    pdf.line(W / 2 - 150, 130, W / 2 + 150, 130);
    put(pdf, `${m.semesterLine.fr} / ${m.semesterLine.en}`, W / 2, 144, { font: 'times', style: 'italic', size: 9.5, align: 'center', color: MUTED });

    let y = 168;
    const line = (label, value) => {
        const lw = put(pdf, label, M, y, { style: 'bold', size: 9.5 });
        const shown = fitText(pdf, value, CW - lw - 8, { style: 'bold', size: 9.5 });
        put(pdf, shown.text, M + lw + 6, y, { style: 'bold', size: shown.size });
        y += 15;
    };
    line('ÉTABLISSEMENT :', m.faculty.fr);
    line('FACULTY / SCHOOL :', m.faculty.en);
    return y + 4;
}

/** Deux colonnes d'identité bilingues (libellés en italique, valeurs en gras). Retourne l'ordonnée de fin. */
function drawIdentity(pdf, m, y) {
    const labelOf = (r) => `${r.fr} / ${r.en} :`;
    const labelStyle = { font: 'times', style: 'bolditalic', size: 9.5 };

    // Nom et prénoms : pleine largeur, c'est l'information principale
    const nameLabel = labelOf(m.identity.name);
    const nameW = put(pdf, nameLabel, M, y, labelStyle);
    const name = fitText(pdf, m.identity.name.value, CW - nameW - 10, { style: 'bold', size: 11 }, 8);
    put(pdf, name.text, M + nameW + 8, y, { style: 'bold', size: name.size });
    y += 20;

    const cols = [{ x: M, w: 232, rows: m.identity.left }, { x: M + 246, w: CW - 246, rows: m.identity.right }];
    const ends = cols.map((col) => {
        const labelW = Math.max(...col.rows.map((r) => widthOf(pdf, labelOf(r), labelStyle)));
        const valueW = col.w - labelW - 8;
        let cy = y;
        col.rows.forEach((row) => {
            put(pdf, labelOf(row), col.x, cy, labelStyle);
            // Une seule ligne si possible (taille réduite jusqu'à 8), sinon retour à la ligne
            const one = fitText(pdf, row.value, valueW, { style: 'bold', size: 9 }, 8);
            const fits = widthOf(pdf, one.text, { style: 'bold', size: one.size }) <= valueW && !one.text.endsWith('...');
            const lines = fits ? [one.text] : wrap(pdf, row.value, valueW, { style: 'bold', size: 8.5 });
            lines.forEach((ln, k) => put(pdf, ln, col.x + labelW + 8, cy + k * 10.5, { style: 'bold', size: fits ? one.size : 8.5 }));
            cy += lines.length * 10.5 + 5.5;
        });
        return cy;
    });
    return Math.max(...ends);
}

/** Tableau principal : une rangée par UE (en gras) suivie de ses matières. Retourne l'ordonnée de fin. */
function drawTable(pdf, m, y) {
    const fixed = m.columns.filter((c) => c.width).reduce((sum, c) => sum + c.width, 0);
    const cols = m.columns.map((c) => ({ ...c, w: c.width ?? CW - fixed }));
    const xs = [];
    cols.reduce((x, c) => { xs.push(x); return x + c.w; }, M);

    const headH = 28;
    pdf.setFillColor(...GRAY);
    pdf.rect(M, y, CW, headH, 'F');
    cols.forEach((c, i) => {
        const cx = c.align === 'left' ? xs[i] + 6 : xs[i] + c.w / 2;
        const align = c.align === 'left' ? 'left' : 'center';
        const fr = fitText(pdf, c.fr, c.w - 10, { style: 'bold', size: 8.5 }, 6.5);
        put(pdf, fr.text, cx, y + 12, { style: 'bold', size: fr.size, align });
        put(pdf, c.en, cx, y + 23, { font: 'times', style: 'italic', size: 8, align, color: MUTED });
    });

    const rowCount = m.groups.reduce((sum, g) => sum + 1 + g.lines.length, 0);
    const unitH = rowCount > 16 ? 15 : 19;
    const lineH = rowCount > 16 ? 14 : 17;
    const bodyH = m.groups.reduce((sum, g) => sum + unitH + g.lines.length * lineH, 0) + 10;

    let cy = y + headH + 4;
    const cell = (value, i, rowY, opts = {}) => {
        const c = cols[i];
        const align = c.align === 'left' ? 'left' : 'center';
        put(pdf, value, align === 'left' ? xs[i] + 6 : xs[i] + c.w / 2, rowY, { size: 9, align, ...opts });
    };
    m.groups.forEach((g) => {
        const ry = cy + unitH - 6;
        cell(g.unit.code, 0, ry, { style: 'bold' });
        const title = fitText(pdf, g.unit.title, cols[1].w - 12, { style: 'bold', size: 9 });
        cell(title.text, 1, ry, { style: 'bold', size: title.size });
        cell(g.unit.mark, 2, ry, { style: 'bold' });
        cell(g.unit.credits, 3, ry, { style: 'bold' });
        cy += unitH;
        g.lines.forEach((l) => {
            const ly = cy + lineH - 5;
            cell(l.code, 0, ly, { size: 8.5 });
            const sub = fitText(pdf, l.title, cols[1].w - 22, { size: 8.5 });
            put(pdf, sub.text, xs[1] + 16, ly, { size: sub.size });
            cell(l.mark, 2, ly, { size: 8.5, color: l.low ? RED : INK, style: l.low ? 'bold' : 'normal' });
            cell(l.credits, 3, ly, { size: 8.5 });
            cell(l.year, 4, ly, { size: 8.5 });
            cell(l.semester, 5, ly, { size: 8.5 });
            cy += lineH;
        });
    });

    // Cadre : contour, séparateurs de l'en-tête, trait sous l'en-tête
    const bottom = y + headH + bodyH;
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.9);
    pdf.rect(M, y, CW, bottom - y);
    pdf.setLineWidth(0.6);
    pdf.line(M, y + headH, M + CW, y + headH);
    cols.slice(1).forEach((c, i) => pdf.line(xs[i + 1], y, xs[i + 1], y + headH));
    return bottom;
}

/** Récapitulatif : mention, total des crédits, moyenne, décision. */
function drawSummary(pdf, m, y) {
    const n = m.summary.length;
    const w = CW / n;
    const headH = 30;
    const bodyH = 34;
    pdf.setFillColor(...GRAY);
    pdf.rect(M, y, CW, headH, 'F');
    m.summary.forEach((cell, i) => {
        const cx = M + i * w + w / 2;
        put(pdf, cell.fr, cx, y + 13, { style: 'bold', size: 9, align: 'center' });
        put(pdf, cell.en, cx, y + 24, { font: 'times', style: 'italic', size: 8.5, align: 'center', color: MUTED });
        const tone = { ok: GREEN, warn: ORANGE, low: RED }[cell.tone] ?? INK;
        const big = fitText(pdf, cell.value, w - 12, { style: 'bold', size: 13 }, 8);
        put(pdf, big.text, cx, y + headH + (cell.note ? 17 : 22), { style: 'bold', size: big.size, align: 'center', color: tone });
        if (cell.note) put(pdf, cell.note, cx, y + headH + 28, { font: 'times', style: 'italic', size: 8, align: 'center', color: MUTED });
    });
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.9);
    pdf.rect(M, y, CW, headH + bodyH);
    pdf.setLineWidth(0.6);
    pdf.line(M, y + headH, M + CW, y + headH);
    for (let i = 1; i < n; i += 1) pdf.line(M + i * w, y, M + i * w, y + headH + bodyH);
    return y + headH + bodyH;
}

function drawRemarks(pdf, m, y) {
    put(pdf, 'Observations du jury / Jury remarks :', M, y, { font: 'times', style: 'bolditalic', size: 9.5 });
    const r = m.remarks;
    const meta = `Classement / Rank : ${r.rank}   ·   Moyenne de la classe / Class average : ${r.classAverage}${r.unranked ? `   (${r.unranked})` : ''}`;
    put(pdf, meta, M, y + 14, { size: 8.5, color: MUTED });
    const lines = wrap(pdf, r.appreciation, CW - 4, { font: 'times', style: 'italic', size: 9.5 });
    lines.forEach((ln, i) => put(pdf, ln, M, y + 29 + i * 12, { font: 'times', style: 'italic', size: 9.5 }));
    return y + 29 + lines.length * 12;
}

function drawSignatures(pdf, m, y) {
    put(pdf, `Délivré le / Issued on : ${m.issuedOn}`, W / 2, y, { size: 8.5, align: 'center', color: MUTED });
    const colW = CW / 2;
    m.signatures.forEach((sig, i) => {
        const cx = M + i * colW + colW / 2;
        put(pdf, sig.fr, cx, y + 28, { style: 'bold', size: 10.5, align: 'center' });
        put(pdf, sig.en, cx, y + 41, { font: 'times', style: 'bolditalic', size: 10, align: 'center' });
        pdf.setDrawColor(...MUTED);
        pdf.setLineWidth(0.5);
        pdf.line(cx - 78, y + 98, cx + 78, y + 98);
        if (sig.name) put(pdf, sig.name, cx, y + 111, { style: 'bold', size: 10, align: 'center' });
    });
}

function drawFooter(pdf, m, doc, page, pages) {
    put(pdf, `${m.notice.fr} / ${m.notice.en}`, W / 2, H - 50, { font: 'times', style: 'bolditalic', size: 8.5, align: 'center' });
    pdf.setDrawColor(...MUTED);
    pdf.setLineWidth(0.4);
    pdf.line(M, H - 40, W - M, H - 40);
    put(pdf, `${doc.appName} · ${doc.department}`, M, H - 28, { size: 7.5, color: MUTED });
    put(pdf, `Relevé ${m.number} · généré le ${formatDate(doc.generatedAt)}`, W / 2, H - 28, { size: 7.5, color: MUTED, align: 'center' });
    put(pdf, `Page ${page} / ${pages}`, W - M, H - 28, { size: 7.5, color: MUTED, align: 'right' });
}

function drawTranscript(pdf, doc, page, pages) {
    const m = transcriptModel(doc);
    drawWatermark(pdf, m.outdated ? 'NON À JOUR' : 'ORIGINAL', m.outdated ? [253, 226, 226] : [236, 238, 237]);
    let y = drawHeader(pdf, m);
    y = drawIdentity(pdf, m, y + 6);
    y = drawTable(pdf, m, y + 10);
    y = drawSummary(pdf, m, y + 12);
    y = drawRemarks(pdf, m, y + 22);
    drawSignatures(pdf, m, Math.max(y + 24, 612));
    drawFooter(pdf, m, doc, page, pages);
}

// ---- API -----------------------------------------------------------------------------------------

/** Construit le PDF (une page par relevé). Retourne l'instance jsPDF. */
export async function buildBulletinPdf(docs) {
    const JsPdf = await loadJsPdf();
    const pdf = new JsPdf({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
    const first = docs[0];
    pdf.setProperties({
        title: docs.length === 1 ? t(`Relevé de notes ${first.semester} ${first.academicYear} - ${fullName(first.student)}`) : t(`Relevés de notes ${first.semester} ${first.academicYear} - ${first.cls.label}`),
        subject: t(`Relevé de notes / Transcript - semestre ${first.semester} - année académique ${first.academicYear}`),
        author: t(first.department),
        creator: t(first.appName),
        keywords: 'relevé de notes, transcript, semestre',
    });
    pdf.setCreationDate?.(new Date());
    docs.forEach((doc, i) => {
        if (i > 0) pdf.addPage();
        drawTranscript(pdf, doc, i + 1, docs.length);
    });
    return pdf;
}

/** Génère et télécharge le PDF. Retourne le nom du fichier. */
export async function downloadBulletinPdf(docs, filename) {
    const pdf = await buildBulletinPdf(docs);
    const name = filename ?? (docs.length === 1
        ? bulletinFileName(docs[0])
        : `Bulletins_${docs[0].semester}_${docs[0].academicYear}_${todayISO()}.pdf`);
    downloadBlob(pdf.output('blob'), name);
    return name;
}
