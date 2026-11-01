/*
 * Modèle du relevé de notes (« Relevé de notes / Transcript »), au format usuel des universités camerounaises :
 * en-tête République du Cameroun bilingue, identité de l'étudiant, tableau par unités d'enseignement (UE) avec crédits,
 * récapitulatif (mention, total des crédits, moyenne, décision), deux signataires et mention d'authenticité.
 *
 * Ce fichier ne dessine rien : il prépare les textes et les valeurs affichés, pour que le PDF (bulletin-pdf.js) et
 * l'aperçu à l'écran (components/bulletin-view.js) restent strictement identiques.
 * Entrée : un document retourné par BulletinService.getDocument().
 */

import { formatDate, formatGrade, formatNumber } from './format.js';

export const REPUBLIC = {
    fr: { name: 'RÉPUBLIQUE DU CAMEROUN', motto: 'Paix - Travail - Patrie' },
    en: { name: 'REPUBLIC OF CAMEROON', motto: 'Peace - Work - Fatherland' },
};

export const COLUMNS = [
    { key: 'code', fr: 'Code', en: 'Code', width: 64, align: 'left' },
    { key: 'title', fr: "L'intitulé de l'unité d'Enseignement (UE)", en: 'Course title', width: null, align: 'left' },
    { key: 'mark', fr: 'Note/20', en: 'Marks/20', width: 58, align: 'center' },
    { key: 'credits', fr: 'Crédits', en: 'Credits', width: 52, align: 'center' },
    { key: 'year', fr: 'Année', en: 'Year', width: 44, align: 'center' },
    { key: 'semester', fr: 'Semestre', en: 'Semester', width: 58, align: 'center' },
];

export const NOTICE = {
    fr: 'Ce relevé, pour être valide, ne doit contenir ni surcharge, ni rature.',
    en: 'This transcript is not authentic if it contains modifications.',
};

const DECISIONS = {
    Admis: { fr: 'ADMIS(E)', en: 'Passed' },
    Rattrapage: { fr: 'RATTRAPAGE', en: 'Resit session' },
    'Ajourné': { fr: 'AJOURNÉ(E)', en: 'Failed' },
    Incomplet: { fr: 'INCOMPLET', en: 'Incomplete' },
};

const upper = (value) => String(value ?? '').toLocaleUpperCase('fr-FR');
const ordinal = (n) => `${n}${n === 1 ? 'er' : 'e'}`;
const mark = (value) => (value === null || value === undefined ? '-' : formatGrade(value));
const credits = (value, digits = 0) => formatNumber(value, digits).replace(/\s/g, ' ');

/** Lignes d'identité : { fr, en, value }, réparties en deux colonnes comme sur le modèle officiel. */
function identity(doc) {
    const { student, cls, institution } = doc;
    return {
        name: { fr: 'Nom et Prénoms', en: 'Name and Surname', value: upper(`${student.lastName} ${student.firstName}`) },
        left: [
            { fr: 'Date de Naissance', en: 'Born on the', value: formatDate(student.birthDate) },
            { fr: 'à', en: 'at', value: student.birthPlace ? upper(student.birthPlace) : '-' },
            { fr: 'Matricule', en: 'Reg N°', value: student.matricule },
        ],
        right: [
            { fr: 'Domaine', en: 'Area', value: institution.domain.fr },
            { fr: 'Spécialisation', en: 'Major', value: upper(cls.filiere) },
            { fr: 'Niveau', en: 'Level', value: upper(cls.levelLabel) },
            { fr: 'Cycle', en: 'Degree', value: cls.cycle.fr },
            { fr: 'Année Académique', en: 'Academic Year', value: doc.academicYear.replace('-', '/') },
        ],
    };
}

/** Regroupe les matières par UE : [{ unit: { code, title, mark, credits }, lines: [{ code, title, mark, credits, year, semester }] }] */
function groups(doc) {
    const year = doc.academicYear.split('-').pop();
    const byId = new Map(doc.lines.map((l) => [l.subjectId, l]));
    // Le relevé stocke les UE (moyenne, crédits) et chaque matière porte son unitId.
    const known = doc.units.length ? doc.units : [];
    const unitLines = (unit) => doc.lines.filter((l) => l.unitId === unit.unitId);
    const result = known.map((unit) => ({
        unit: { code: unit.code, title: `${unit.name}${unit.type ? ` (${unit.type})` : ''}`, mark: mark(unit.average), credits: credits(unit.credits, 2) },
        lines: unitLines(unit),
    }));
    const placed = new Set(result.flatMap((g) => g.lines.map((l) => l.subjectId)));
    const orphans = [...byId.values()].filter((l) => !placed.has(l.subjectId));
    if (orphans.length) {
        const total = orphans.reduce((sum, l) => sum + l.coefficient, 0);
        result.push({ unit: { code: '', title: 'Autres enseignements', mark: '', credits: credits(total, 2) }, lines: orphans });
    }
    return result.filter((g) => g.lines.length).map((g) => ({
        unit: g.unit,
        lines: g.lines.map((l) => ({
            code: l.code, title: l.name,
            // Note finale de la matière (avec rattrapage le cas échéant)
            mark: mark(l.average), low: l.average !== null && l.average < doc.grading.passMark,
            credits: credits(l.coefficient), year, semester: doc.semester,
        })),
    }));
}

/** Tout ce qu'il faut pour dessiner le relevé. */
export function transcriptModel(doc) {
    const decision = DECISIONS[doc.result] ?? DECISIONS.Incomplet;
    return {
        number: doc.number,
        republic: REPUBLIC,
        university: doc.institution.university,
        faculty: doc.institution.faculty,
        title: { fr: 'RELEVÉ DE NOTES', en: 'TRANSCRIPT' },
        semesterLine: { fr: `Semestre ${doc.semester}`, en: `Semester ${doc.semester}` },
        identity: identity(doc),
        columns: COLUMNS,
        groups: groups(doc),
        summary: [
            { fr: 'Mention', en: 'Grade', value: doc.mention ? upper(doc.mention) : '-' },
            { fr: 'Total des crédits', en: 'Total number of credits', value: credits(doc.credits.acquired, 2), note: `sur ${credits(doc.credits.total)}` },
            { fr: 'Moyenne / 20', en: 'Grade Point Average', value: mark(doc.average) },
            { fr: 'Décision', en: 'Overall Results', value: decision.fr, note: decision.en, tone: doc.result === 'Admis' ? 'ok' : doc.result === 'Rattrapage' ? 'warn' : 'low' },
        ],
        remarks: {
            rank: doc.rank ? `${ordinal(doc.rank)} sur ${doc.classRanked}` : '-',
            classAverage: mark(doc.classAverage),
            unranked: doc.classRanked !== doc.classSize ? `${doc.classRanked} relevés complets sur ${doc.classSize}` : null,
            appreciation: doc.appreciation,
        },
        issuedOn: formatDate(doc.generatedAt),
        signatures: [
            { fr: 'Le Chef de Département', en: 'The Head of Department', name: doc.chief ? `${doc.chief.firstName} ${doc.chief.lastName}` : '' },
            { fr: doc.institution.dean.title.fr, en: doc.institution.dean.title.en, name: doc.institution.dean.name },
        ],
        notice: NOTICE,
        outdated: doc.outdated,
        passMark: doc.grading.passMark,
    };
}
