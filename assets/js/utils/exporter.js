/*
 * Export de tableaux : classeur Excel (.xlsx) mis en forme, ou CSV de secours.
 *
 * Une seule description (« spec ») alimente les deux formats :
 * {
 *   filename: 'etudiants',                     // sans extension ni date (ajoutées automatiquement)
 *   sheets: [{
 *     name: 'Étudiants',                       // nom de l'onglet (31 caractères max)
 *     title: 'Liste des étudiants',
 *     subtitle: ['ligne 1', 'ligne 2'],        // voir exportInfo()
 *     columns: [{ header: 'Matricule', type: 'text', width: 14, align, tone, lowBelow }],
 *     rows: [['26GL3001', ...]],               // valeurs brutes : nombres = number, dates = 'AAAA-MM-JJ'
 *   }]
 * }
 * type : text | integer | decimal (0,00) | decimal1 (0,0) | grade (0,00 ; rouge sous lowBelow) | percent | date.
 * tone(valeur, ligne) -> 'good' | 'warn' | 'bad' | 'neutral' colore la cellule (statuts).
 * Le CSV ne reprend que le premier onglet : en-têtes puis données, sans titre (format d'échange).
 */

import { config } from '../config.js';
import { formatDate, parseDate, todayISO } from './format.js';
import { loadExcelJs } from './loader.js';

const C = { forest: 'FF072F1F', text: 'FF0B130F', muted: 'FF6C7E75', border: 'FFE0E7E3', zebra: 'FFF8FAF9', white: 'FFFFFFFF', red: 'FFB91C1C' };
const TONES = {
    good: { fill: 'FFDCFCE7', font: 'FF15803D' },
    warn: { fill: 'FFFFEDD5', font: 'FFC2410C' },
    bad: { fill: 'FFFEE2E2', font: 'FFB91C1C' },
    neutral: { fill: 'FFE9EFEF', font: 'FF6C7E75' },
};
const NUMFMT = { integer: '0', decimal: '0.00', decimal1: '0.0', grade: '0.00', percent: '0.0" %"', date: 'dd/mm/yyyy' };
const DEFAULT_ALIGN = { text: 'left', integer: 'center', decimal: 'center', decimal1: 'center', grade: 'center', percent: 'center', date: 'center' };
const THIN = { style: 'thin', color: { argb: C.border } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const FONT = 'Calibri';

/** Lignes d'en-tête sous le titre : application, période, date d'export, effectif et filtres actifs. */
export function exportInfo({ summary, filters = [] }) {
    return [
        `${config.APP_NAME} · ${config.DEPARTMENT} · Année universitaire ${config.ACADEMIC_YEAR}`,
        `Exporté le ${formatDate(todayISO())} · ${summary}${filters.length ? ` · Filtres : ${filters.join(' ; ')}` : ''}`,
    ];
}

/** Décrit les filtres actifs. entrées : [libellé, élément <select> ou <input>] ; les valeurs vides sont ignorées. */
export function describeFilters(entries) {
    return entries.flatMap(([label, el]) => {
        if (!el?.value) return [];
        const shown = el.tagName === 'SELECT' ? el.selectedOptions[0].textContent.trim() : `« ${el.value.trim()} »`;
        return [`${label} : ${shown}`];
    });
}

const sheetName = (name, taken) => {
    let base = String(name).replace(/[\[\]:*?/\\]/g, '-').slice(0, 31) || 'Feuille';
    let candidate = base;
    for (let i = 2; taken.has(candidate.toLowerCase()); i += 1) candidate = `${base.slice(0, 28)} ${i}`;
    taken.add(candidate.toLowerCase());
    return candidate;
};

/** Largeur de colonne : celle demandée, sinon estimée d'après le contenu. */
function widthOf(column, index, rows) {
    if (column.width) return column.width;
    const longest = rows.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), String(column.header).length * 0.9);
    return Math.min(60, Math.max(10, Math.ceil(longest * 1.15) + 3));
}

const excelDate = (iso) => {
    const d = parseDate(iso);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

function addSheet(workbook, sheet, taken) {
    const { columns, rows } = sheet;
    const subtitles = sheet.subtitle ?? [];
    const headerRow = subtitles.length + 3; // titre, sous-titres, ligne vide, en-têtes
    const count = columns.length;
    const ws = workbook.addWorksheet(sheetName(sheet.name ?? sheet.title, taken), {
        views: [{ state: 'frozen', ySplit: headerRow, showGridLines: false }],
        properties: { tabColor: { argb: C.forest } },
        pageSetup: {
            paperSize: 9, orientation: count > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            printTitlesRow: `${headerRow}:${headerRow}`,
            margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
        },
        headerFooter: { oddFooter: `&L&8${config.APP_NAME} · ${config.DEPARTMENT}&C&8Page &P / &N&R&8${formatDate(todayISO())}` },
    });
    columns.forEach((column, i) => { ws.getColumn(i + 1).width = widthOf(column, i, rows); });

    const merge = (row) => { if (count > 1) ws.mergeCells(row, 1, row, count); };
    const title = ws.getCell(1, 1);
    title.value = sheet.title;
    title.font = { name: FONT, size: 16, bold: true, color: { argb: C.forest } };
    title.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 30;
    merge(1);
    subtitles.forEach((line, i) => {
        const cell = ws.getCell(2 + i, 1);
        cell.value = line;
        cell.font = { name: FONT, size: 10, italic: i > 0, color: { argb: C.muted } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
        merge(2 + i);
    });

    const head = ws.getRow(headerRow);
    head.height = 32;
    columns.forEach((column, i) => {
        const cell = head.getCell(i + 1);
        cell.value = column.header;
        cell.font = { name: FONT, size: 10.5, bold: true, color: { argb: C.white } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.forest } };
        const align = column.align ?? DEFAULT_ALIGN[column.type ?? 'text'];
        cell.alignment = { vertical: 'middle', horizontal: align === 'left' ? 'left' : 'center', wrapText: true };
        cell.border = BORDER;
    });

    rows.forEach((values, r) => {
        const row = ws.getRow(headerRow + 1 + r);
        row.height = 21;
        columns.forEach((column, i) => {
            const type = column.type ?? 'text';
            const raw = values[i];
            const cell = row.getCell(i + 1);
            const empty = raw === null || raw === undefined || raw === '';
            if (!empty) cell.value = type === 'date' ? excelDate(raw) : type === 'text' ? String(raw) : Number(raw);
            if (NUMFMT[type]) cell.numFmt = NUMFMT[type];
            cell.alignment = { vertical: 'middle', horizontal: column.align ?? DEFAULT_ALIGN[type], wrapText: type === 'text' && column.wrap === true, indent: type === 'text' ? 1 : 0 };
            cell.border = BORDER;
            const tone = !empty && column.tone ? TONES[column.tone(raw, values)] : null;
            const low = !empty && type === 'grade' && column.lowBelow !== undefined && Number(raw) < column.lowBelow;
            cell.font = { name: FONT, size: 10.5, bold: Boolean(tone) || low, color: { argb: tone?.font ?? (low ? C.red : C.text) } };
            if (tone) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } };
            else if (r % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
        });
    });

    if (rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: count } };
}

/** Construit le classeur. Retourne un Blob .xlsx. */
export async function buildWorkbook(spec) {
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = config.APP_NAME;
    workbook.lastModifiedBy = config.APP_NAME;
    workbook.company = config.DEPARTMENT;
    workbook.title = spec.sheets[0].title;
    workbook.created = new Date();
    workbook.modified = new Date();
    const taken = new Set();
    spec.sheets.forEach((sheet) => addSheet(workbook, sheet, taken));
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---- CSV ---------------------------------------------------------------------------------------

const csvValue = (value, type) => {
    if (value === null || value === undefined || value === '') return '';
    switch (type) {
        case 'date': return formatDate(value);
        case 'grade': case 'decimal': return Number(value).toFixed(2).replace('.', ',');
        case 'decimal1': case 'percent': return Number(value).toFixed(1).replace('.', ',');
        default: return String(value);
    }
};

/** Une cellule CSV : guillemets doublés, et neutralisation des formules (= + - @) pour les tableurs. */
function csvCell(text) {
    let out = text;
    if (/^[=+\-@\t\r]/.test(out) && !/^[+-]?\d[\d\s.,]*$/.test(out) && !/^\+\d[\d\s]*$/.test(out)) out = `'${out}`;
    return /[";\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

/** CSV au format français : séparateur « ; », virgule décimale, BOM UTF-8 (accents corrects dans Excel). */
export function buildCsv(spec) {
    const { columns, rows } = spec.sheets[0];
    const lines = [columns.map((c) => c.header), ...rows.map((row) => row.map((v, i) => csvValue(v, columns[i].type ?? 'text')))];
    return `﻿${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

// ---- Téléchargement ----------------------------------------------------------------------------

export function downloadBlob(blob, filename) {
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/** Exporte au format demandé ('xlsx' | 'csv'). Retourne le nom du fichier téléchargé. */
export async function exportSpec(spec, format) {
    const name = `${spec.filename}-${todayISO()}.${format}`;
    const blob = format === 'csv'
        ? new Blob([buildCsv(spec)], { type: 'text/csv;charset=utf-8' })
        : await buildWorkbook(spec);
    downloadBlob(blob, name);
    return name;
}
