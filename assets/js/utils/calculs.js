/*
 * Règles de calcul métier (moyennes, mentions, heures, présences).
 * Fonctions PURES, sans dépendance au DOM ni au stockage : réutilisées par les services,
 * les pages et le générateur de données (tools/generate-mock.mjs).
 *
 * Les règles sont celles retenues dans projet.md §7 ; elles pourront être remplacées
 * par les valeurs calculées du backend (voir hoursSummary).
 */

export const WEIGHTS = { CC: 0.3, EXAMEN: 0.7 };
export const PASS_MARK = 10;
export const MENTIONS = [
    { min: 16, label: 'Très bien' },
    { min: 14, label: 'Bien' },
    { min: 12, label: 'Assez bien' },
    { min: 10, label: 'Passable' },
];

export const round2 = (n) => Math.round(n * 100) / 100;

// Arrondi EXACT : les notes ont deux décimales, on calcule en centièmes (entiers) et on arrondit une seule fois,
// « moitié vers le haut ». Évite qu'une moyenne tombant sur un demi-centime dépende de l'ordre des additions flottantes
// (le backend PHP applique la même méthode : les deux restent identiques au centième près).
const toCents = (v) => Math.round(v * 100);
const divRound = (numerator, denominator) => Math.floor((2 * numerator + denominator) / (2 * denominator));

/**
 * Moyenne d'une matière pour un étudiant, à partir de SES notes VALIDÉES dans cette matière.
 * La note de rattrapage remplace celle de l'examen. Retourne null si CC ou examen manque.
 */
export function subjectAverage(grades) {
    const last = (type) => {
        const found = grades.filter((g) => g.type === type);
        return found.length ? found[found.length - 1].value : null;
    };
    const cc = last('CC');
    const exam = last('RATTRAPAGE') ?? last('EXAMEN');
    if (cc === null || exam === null) return null;
    // cc × 0,3 + exam × 0,7 en centièmes : (3 × CC + 7 × EX) / 10
    return divRound(Math.round(WEIGHTS.CC * 10) * toCents(cc) + Math.round(WEIGHTS.EXAMEN * 10) * toCents(exam), 10) / 100;
}

/**
 * Moyenne générale pondérée par les coefficients.
 * entries : [{ average: number|null, coefficient: number }]
 * Si une matière n'a pas de moyenne, la moyenne générale n'est pas calculable (complete = false).
 */
export function generalAverage(entries) {
    const totalCoefficient = entries.reduce((sum, e) => sum + e.coefficient, 0);
    const complete = entries.length > 0 && entries.every((e) => e.average !== null);
    if (!complete) return { average: null, complete: false, totalCoefficient };
    const weighted = entries.reduce((sum, e) => sum + toCents(e.average) * toCents(e.coefficient), 0);
    const coefficients = entries.reduce((sum, e) => sum + toCents(e.coefficient), 0);
    return { average: divRound(weighted, coefficients) / 100, complete: true, totalCoefficient };
}

export function mention(average) {
    if (average === null || average === undefined) return null;
    return MENTIONS.find((m) => average >= m.min)?.label ?? null;
}

/** Résultat final : Admis / Ajourné / Rattrapage (si une session de rattrapage est ouverte) / Incomplet. */
export function finalResult(average, { rattrapageOpen = false } = {}) {
    if (average === null || average === undefined) return 'Incomplet';
    if (average >= PASS_MARK) return 'Admis';
    return rattrapageOpen ? 'Rattrapage' : 'Ajourné';
}

/**
 * Regroupe les lignes d'un relevé par unité d'enseignement (UE). Une UE a une moyenne (pondérée par les crédits)
 * dès que toutes ses matières ont une moyenne ; elle est « validée » à 10 ou plus.
 * Les matières sans unité sont regroupées sous une unité fictive (unitId null) en fin de liste.
 * Le crédit d'une matière est son coefficient (1 coefficient = 1 crédit).
 */
function groupByUnit(lines, units) {
    const make = (unit, own) => {
        const complete = own.length > 0 && own.every((l) => l.average !== null);
        const credits = own.reduce((sum, l) => sum + l.coefficient, 0);
        const average = complete
            ? divRound(own.reduce((sum, l) => sum + toCents(l.average) * toCents(l.coefficient), 0), own.reduce((sum, l) => sum + toCents(l.coefficient), 0)) / 100
            : null;
        return { unitId: unit.id ?? null, code: unit.code ?? '', name: unit.name, type: unit.type ?? null, credits, average, validated: average !== null && average >= PASS_MARK, lines: own };
    };
    const groups = units.map((u) => make(u, lines.filter((l) => l.unitId === u.id))).filter((g) => g.lines.length);
    const known = new Set(units.map((u) => u.id));
    const orphans = lines.filter((l) => !known.has(l.unitId));
    if (orphans.length) groups.push(make({ id: null, name: 'Autres enseignements' }, orphans));
    return groups;
}

/**
 * Relevé d'un étudiant pour un semestre (base du bulletin).
 * subjects : matières du niveau/semestre ; grades : toutes les notes de l'étudiant ; units : UE de la classe.
 * Seules les notes validées comptent.
 */
export function buildReport({ subjects, grades, rattrapageOpen = false, units = [] }) {
    const validated = grades.filter((g) => g.status === 'validee');
    const lines = subjects.map((subject) => {
        const own = validated.filter((g) => g.subjectId === subject.id);
        const pick = (type) => own.filter((g) => g.type === type).at(-1)?.value ?? null;
        return {
            subjectId: subject.id,
            unitId: subject.unitId ?? null,
            code: subject.code,
            name: subject.name,
            coefficient: subject.coefficient,
            cc: pick('CC'),
            exam: pick('EXAMEN'),
            rattrapage: pick('RATTRAPAGE'),
            average: subjectAverage(own),
        };
    });
    const general = generalAverage(lines.map((l) => ({ average: l.average, coefficient: l.coefficient })));
    const result = finalResult(general.average, { rattrapageOpen });
    const grouped = groupByUnit(lines, units);
    return {
        lines,
        units: grouped,
        average: general.average,
        complete: general.complete,
        totalCoefficient: general.totalCoefficient,
        mention: mention(general.average),
        result,
        // Crédits : tous acquis si le semestre est validé (compensation), sinon ceux des UE validées
        credits: {
            total: general.totalCoefficient,
            acquired: result === 'Admis' ? general.totalCoefficient : grouped.filter((u) => u.validated).reduce((sum, u) => sum + u.credits, 0),
        },
    };
}

// ---- Heures et présences ---------------------------------------------------

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

/** Durée d'une séance en heures décimales (08:00-10:15 -> 2.25). */
export function sessionHours(session) {
    return (toMinutes(session.endTime) - toMinutes(session.startTime)) / 60;
}

/**
 * Résumé des heures d'un enseignant (objet hoursSummary, voir projet.md §7).
 * Le backend pourra fournir directement cet objet ; les pages ne calculent jamais elles-mêmes.
 */
export function hoursSummary({ teacher, subjects, sessions, period }) {
    const planned = subjects.filter((s) => s.teacherId === teacher.id).reduce((sum, s) => sum + s.plannedHours, 0);
    const done = sessions
        .filter((s) => s.teacherId === teacher.id && s.status === 'present')
        .reduce((sum, s) => sum + sessionHours(s), 0);
    const contract = teacher.contractHours;
    return {
        teacherId: teacher.id,
        period,
        planned,
        done: round2(done),
        contract,
        overtime: round2(Math.max(0, done - contract)),
        missing: round2(Math.max(0, planned - done)),
    };
}

/** Taux de présence en % (une décimale) ou null s'il n'y a aucune séance. */
export function presenceRate(sessions) {
    if (!sessions.length) return null;
    const present = sessions.filter((s) => s.status === 'present').length;
    return Math.round((present / sessions.length) * 1000) / 10;
}

// ---- Statistiques ------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;
const sum = (values) => values.reduce((total, v) => total + v, 0);

/** Moyenne arrondie à 2 décimales en ignorant les valeurs absentes ; null s'il n'y en a aucune. */
export function mean(values) {
    const kept = values.filter((v) => v !== null && v !== undefined);
    return kept.length ? divRound(kept.reduce((total, v) => total + toCents(v), 0), kept.length) / 100 : null;
}

/** Lundi (ISO "YYYY-MM-DD") de la semaine qui contient la date donnée. */
export function weekStart(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() || 7) - 1));
    return date.toISOString().slice(0, 10);
}

/** Compare deux valeurs : écart (delta) et direction ('flat' si l'écart est inférieur à 0,05). */
export function compare(previous, current) {
    if (previous === null || previous === undefined || current === null || current === undefined) return { delta: null, direction: 'flat' };
    const delta = round2(current - previous);
    return { delta, direction: Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down' };
}

/**
 * Tendance d'une série : les `window` derniers points comparés aux `window` précédents (window.size dans le résultat).
 * mode 'sum' (heures, absences) ou 'avg' (taux). Retourne la variation en % (change) et en valeur (delta).
 * direction : 'up' | 'down' | 'flat' (variation < 0,5 % ou série trop courte).
 */
export function trend(values, { window, mode = 'sum' } = {}) {
    // Par défaut 4 points, réduits pour qu'une période courte reste comparable (2 semaines -> 1 contre 1).
    const size = window ?? Math.max(1, Math.min(4, Math.floor(values.length / 2)));
    const aggregate = (part) => (mode === 'avg' ? mean(part) : sum(part));
    const last = values.slice(-size);
    const before = values.slice(-2 * size, -size);
    if (!before.length) return { current: aggregate(last), previous: null, delta: null, change: null, direction: 'flat', window: size };
    const current = aggregate(last);
    const previous = aggregate(before);
    const delta = round2(current - previous);
    const change = previous === 0 ? null : round1((delta / previous) * 100);
    const flat = delta === 0 || (change !== null && Math.abs(change) < 0.5);
    return { current, previous, delta, change, direction: flat ? 'flat' : delta > 0 ? 'up' : 'down', window: size };
}

// ---- Bulletins -----------------------------------------------------------------------------

/**
 * Appréciation du jury, générée selon la moyenne et le résultat (formulation volontairement neutre).
 * retake : intitulés des matières sous la moyenne.
 */
export function appreciation({ average, result, retake = [] }) {
    if (average === null || average === undefined) return 'Relevé incomplet : des notes manquent pour établir la moyenne du semestre.';
    const weak = !retake.length ? '' : retake.length > 3 ? ` ${retake.length} matières sont à consolider.` : ` Matières à consolider : ${retake.join(', ')}.`;
    if (average >= 16) return `Résultats excellents. Le jury adresse ses félicitations et encourage à poursuivre sur cette lancée.${weak}`;
    if (average >= 14) return `Très bon semestre : les résultats sont solides dans l'ensemble des matières.${weak}`;
    if (average >= 12) return `Bon semestre. Les résultats sont satisfaisants ; quelques efforts permettraient de progresser encore.${weak}`;
    if (average >= PASS_MARK) return `Semestre validé. Un travail plus régulier est conseillé pour consolider les acquis.${weak}`;
    if (result === 'Rattrapage') return `Résultats insuffisants pour valider le semestre. Une session de rattrapage est ouverte : le jury recommande de réviser les matières sous la moyenne.${weak}`;
    return `Résultats insuffisants : le semestre n'est pas validé.${weak}`;
}

/**
 * Instantané d'un bulletin : tout ce qu'il faut pour réafficher le document tel qu'il était à sa génération.
 * classmates : [{ studentId, report }] pour TOUTE la classe (l'étudiant inclus), avec les mêmes matières dans le même ordre.
 * Le rang ne compte que les étudiants dont le relevé est complet ; ex æquo = même rang.
 */
export function bulletinSnapshot({ report, classmates }) {
    const ranked = classmates.filter((c) => c.report.complete).map((c) => c.report.average).sort((a, b) => b - a);
    const lines = report.lines.map((line, i) => ({
        subjectId: line.subjectId, unitId: line.unitId, code: line.code, name: line.name, coefficient: line.coefficient,
        cc: line.cc, exam: line.exam, rattrapage: line.rattrapage, average: line.average,
        classAverage: mean(classmates.map((c) => c.report.lines[i].average)),
    }));
    const retake = lines.filter((l) => l.average !== null && l.average < PASS_MARK).map((l) => l.name);
    return {
        average: report.average,
        mention: report.mention,
        result: report.result,
        rank: report.complete ? ranked.filter((v) => v > report.average).length + 1 : null,
        classRanked: ranked.length,
        classSize: classmates.length,
        classAverage: mean(ranked),
        totalCoefficient: report.totalCoefficient,
        credits: report.credits,
        units: report.units.map((u) => ({ unitId: u.unitId, code: u.code, name: u.name, type: u.type, credits: u.credits, average: u.average, validated: u.validated })),
        lines,
        retake,
        appreciation: appreciation({ average: report.average, result: report.result, retake }),
    };
}

/** Deux instantanés décrivent-ils les mêmes résultats et le même classement ? (sert à détecter un bulletin à régénérer) */
export function sameResults(a, b) {
    if (a.average !== b.average || a.rank !== b.rank || a.classRanked !== b.classRanked || a.lines.length !== b.lines.length) return false;
    const unitsKey = (s) => JSON.stringify((s.units ?? []).map((u) => [u.unitId, u.average, u.credits]));
    if (unitsKey(a) !== unitsKey(b) || a.credits?.acquired !== b.credits?.acquired) return false;
    return a.lines.every((l, i) => {
        const o = b.lines[i];
        return l.subjectId === o.subjectId && l.coefficient === o.coefficient && l.cc === o.cc && l.exam === o.exam && l.rattrapage === o.rattrapage && l.average === o.average;
    });
}
