/*
 * Pédagogie : matières, notes, bulletins.
 *
 * Règles de gestion des notes (projet.md §7) :
 *  - seul l'enseignant de la matière saisit et valide ; le chef et les étudiants consultent ;
 *  - une note est d'abord un brouillon (modifiable, effaçable), puis validée : elle est alors verrouillée
 *    et seules les notes validées entrent dans les moyennes et les bulletins ;
 *  - le rattrapage n'existe que pour un étudiant dont la moyenne (CC + examen) est inférieure à 10.
 * Ces contrôles sont faits ici car le backend devra les refaire : l'interface ne fait que les refléter.
 */

import { INSTITUTION, config } from '../config.js';
import { MENTIONS, PASS_MARK, WEIGHTS, buildReport, bulletinSnapshot, sameResults, subjectAverage } from '../utils/calculs.js';
import { todayISO } from '../utils/format.js';
import { EventService } from './calendar.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { idSequence, nextId } from './ids.js';

export const GRADE_TYPES = { CC: 'Contrôle continu', EXAMEN: 'Examen', RATTRAPAGE: 'Rattrapage' };
export const SEMESTERS = ['S1', 'S2'];

const text = (value) => String(value ?? '').trim();
const toNumber = (value) => (text(value) === '' ? NaN : Number(text(value).replace(',', '.')));
const fail = (errors, message = 'Veuillez corriger les champs signalés.') => {
    if (Object.keys(errors).length) throw new ValidationError(message, errors);
};

// ---- Matières ------------------------------------------------------------------------------------

function validateSubject(input, { subjects, levels, teachers, units, ownId }) {
    const errors = {};
    const code = text(input.code).toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(code)) errors.code = 'Code de 2 à 10 lettres ou chiffres (ex. INF201).';
    else if (subjects.some((s) => s.id !== ownId && s.code === code)) errors.code = 'Ce code est déjà utilisé par une autre matière.';
    if (text(input.name).length < 3) errors.name = "L'intitulé est obligatoire (3 caractères minimum).";
    if (!levels.some((l) => l.id === input.levelId)) errors.levelId = 'Choisissez un niveau.';
    if (!SEMESTERS.includes(input.semester)) errors.semester = 'Choisissez un semestre.';
    const coefficient = toNumber(input.coefficient);
    if (!(coefficient > 0 && coefficient <= 10) || Math.abs(coefficient * 10 - Math.round(coefficient * 10)) > 1e-9) errors.coefficient = 'Coefficient entre 0,1 et 10 (une décimale au maximum).';
    const hours = toNumber(input.plannedHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 200) errors.plannedHours = "Nombre entier d'heures entre 1 et 200.";
    if (text(input.teacherId) && !teachers.some((t) => t.id === input.teacherId)) errors.teacherId = 'Enseignant inconnu.';
    const unit = text(input.unitId) ? units.find((u) => u.id === input.unitId) : null;
    if (text(input.unitId) && !unit) errors.unitId = 'Unité d\'enseignement inconnue.';
    else if (unit && (unit.levelId !== input.levelId || unit.semester !== input.semester)) errors.unitId = 'Cette unité n\'appartient pas à la classe ou au semestre choisis.';
    return { errors, code, coefficient, hours };
}

export const SubjectService = {
    /** filters : { levelId, teacherId, semester } */
    async list({ levelId, teacherId, semester } = {}) {
        let items = await list('subjects');
        if (levelId) items = items.filter((s) => s.levelId === levelId);
        if (teacherId) items = items.filter((s) => s.teacherId === teacherId);
        if (semester) items = items.filter((s) => s.semester === semester);
        return items;
    },
    async get(id) {
        return (await list('subjects')).find((s) => s.id === id) ?? null;
    },

    async create(input) {
        const [subjects, levels, teachers, units] = await Promise.all([list('subjects'), list('levels'), list('teachers'), list('units')]);
        const { errors, code, coefficient, hours } = validateSubject(input, { subjects, levels, teachers, units, ownId: null });
        fail(errors);
        const subject = {
            id: nextId('sub', subjects), code, name: text(input.name), coefficient, plannedHours: hours,
            levelId: input.levelId, semester: input.semester, teacherId: text(input.teacherId) || null, unitId: text(input.unitId) || null,
        };
        subjects.push(subject);
        await replaceAll('subjects', subjects);
        return subject;
    },

    async update(id, input) {
        const [subjects, levels, teachers, units] = await Promise.all([list('subjects'), list('levels'), list('teachers'), list('units')]);
        const subject = subjects.find((s) => s.id === id);
        if (!subject) throw new ValidationError('Matière introuvable.');
        const { errors, code, coefficient, hours } = validateSubject(input, { subjects, levels, teachers, units, ownId: id });
        const usage = await this.usage(id);
        // Classe et semestre ne peuvent plus changer dès que des notes ou des séances s'y rattachent
        if (usage.grades || usage.sessions) {
            if (input.levelId !== subject.levelId) errors.levelId = 'Classe non modifiable : des notes ou des séances sont déjà enregistrées.';
            if (input.semester !== subject.semester) errors.semester = 'Semestre non modifiable : des notes ou des séances sont déjà enregistrées.';
        }
        fail(errors);
        Object.assign(subject, {
            code, name: text(input.name), coefficient, plannedHours: hours,
            levelId: input.levelId, semester: input.semester, teacherId: text(input.teacherId) || null, unitId: text(input.unitId) || null,
        });
        await replaceAll('subjects', subjects);
        return subject;
    },

    /** Notes et séances rattachées : ce qui empêche la suppression et le changement de classe. */
    async usage(id) {
        const [grades, sessions] = await Promise.all([list('grades'), list('sessions')]);
        return { grades: grades.filter((g) => g.subjectId === id).length, sessions: sessions.filter((s) => s.subjectId === id).length };
    },

    async remove(id) {
        const subjects = await list('subjects');
        if (!subjects.some((s) => s.id === id)) throw new ValidationError('Matière introuvable.');
        const usage = await this.usage(id);
        if (usage.grades || usage.sessions) {
            const parts = [];
            if (usage.grades) parts.push(`${usage.grades} note${usage.grades > 1 ? 's' : ''}`);
            if (usage.sessions) parts.push(`${usage.sessions} séance${usage.sessions > 1 ? 's' : ''}`);
            throw new ValidationError(`Suppression impossible : cette matière a ${parts.join(' et ')} enregistrée${usage.grades + usage.sessions > 1 ? 's' : ''}.`);
        }
        const checkins = await list('checkins');
        await Promise.all([
            replaceAll('subjects', subjects.filter((s) => s.id !== id)),
            replaceAll('checkins', checkins.filter((c) => c.subjectId !== id)), // simples repères de présence : ne bloquent pas la suppression
        ]);
    },
};

// ---- Notes ---------------------------------------------------------------------------------------

function assertCanGrade(subject, actor) {
    if (!actor || actor.role !== 'enseignant') throw new ValidationError("Seul l'enseignant de la matière peut saisir et valider les notes.");
    if (subject.teacherId !== actor.profileId) throw new ValidationError("Vous n'êtes pas l'enseignant de cette matière.");
}

/** Dernière note d'un type donné pour un étudiant (ou null). */
const pick = (grades, studentId, type) => grades.filter((g) => g.studentId === studentId && g.type === type).at(-1) ?? null;

/** Le rattrapage concerne un étudiant dont la moyenne validée (CC + examen) est inférieure à 10. */
function eligibleForRattrapage(grades, studentId) {
    const cc = pick(grades, studentId, 'CC');
    const exam = pick(grades, studentId, 'EXAMEN');
    if (cc?.status !== 'validee' || exam?.status !== 'validee') return false;
    return subjectAverage([cc, exam]) < 10;
}

export const GradeService = {
    /** filters : { studentId, subjectId, subjectIds, status } */
    async list({ studentId, subjectId, subjectIds, status } = {}) {
        let items = await list('grades');
        if (studentId) items = items.filter((g) => g.studentId === studentId);
        if (subjectId) items = items.filter((g) => g.subjectId === subjectId);
        if (subjectIds) items = items.filter((g) => subjectIds.includes(g.subjectId));
        if (status) items = items.filter((g) => g.status === status);
        return items;
    },
    async countByStatus() {
        const counts = { brouillon: 0, validee: 0 };
        (await list('grades')).forEach((g) => { counts[g.status] = (counts[g.status] ?? 0) + 1; });
        return counts;
    },

    /**
     * Feuille de notes d'une matière : un étudiant par ligne avec ses notes (brouillons compris),
     * sa moyenne (notes validées seulement) et son éligibilité au rattrapage.
     */
    async sheet(subjectId) {
        const [subjects, students, grades, levels, filieres, teachers] = await Promise.all([
            list('subjects'), list('students'), list('grades'), list('levels'), list('filieres'), list('teachers'),
        ]);
        const subject = subjects.find((s) => s.id === subjectId);
        if (!subject) return null;
        const level = levels.find((l) => l.id === subject.levelId);
        const filiere = filieres.find((f) => f.id === level.filiereId);
        const own = grades.filter((g) => g.subjectId === subjectId);
        const rows = students
            .filter((s) => s.levelId === subject.levelId)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))
            .map((student) => {
                const mine = own.filter((g) => g.studentId === student.id);
                return {
                    student,
                    cc: pick(mine, student.id, 'CC'),
                    exam: pick(mine, student.id, 'EXAMEN'),
                    rattrapage: pick(mine, student.id, 'RATTRAPAGE'),
                    average: subjectAverage(mine.filter((g) => g.status === 'validee')),
                    eligibleRattrapage: eligibleForRattrapage(mine, student.id),
                };
            });
        return {
            subject,
            cls: { name: level.name, label: `${level.label} · ${filiere.name}`, short: `${level.name} ${filiere.code}` },
            teacher: teachers.find((t) => t.id === subject.teacherId) ?? null,
            rows,
        };
    },

    /**
     * Enregistre des notes en BROUILLON pour une évaluation.
     * entries : [{ studentId, value }] ; une valeur vide efface le brouillon de l'étudiant.
     * Tout ou rien : s'il y a des erreurs, rien n'est enregistré et l'erreur indique le message de chaque étudiant
     * (clé = studentId).
     */
    async saveDrafts({ subjectId, type, entries }, actor) {
        const [subjects, students, grades] = await Promise.all([list('subjects'), list('students'), list('grades')]);
        const subject = subjects.find((s) => s.id === subjectId);
        if (!subject) throw new ValidationError('Matière introuvable.');
        assertCanGrade(subject, actor);
        if (!GRADE_TYPES[type]) throw new ValidationError("Type d'évaluation inconnu.");

        const classIds = new Set(students.filter((s) => s.levelId === subject.levelId).map((s) => s.id));
        const errors = {};
        const plan = [];
        entries.forEach(({ studentId, value }) => {
            if (!classIds.has(studentId)) { errors[studentId] = "Cet étudiant n'est pas dans la classe de la matière."; return; }
            const existing = grades.find((g) => g.studentId === studentId && g.subjectId === subjectId && g.type === type);
            if (existing?.status === 'validee') { errors[studentId] = 'Note déjà validée : elle ne peut plus être modifiée.'; return; }
            if (text(value) === '') { if (existing) plan.push({ studentId, existing, remove: true }); return; }
            const number = toNumber(value);
            if (Number.isNaN(number)) errors[studentId] = 'Note invalide.';
            else if (number < 0 || number > 20) errors[studentId] = 'La note doit être comprise entre 0 et 20.';
            else if (Math.abs(number * 100 - Math.round(number * 100)) > 1e-6) errors[studentId] = 'Deux décimales au maximum.';
            else if (type === 'RATTRAPAGE' && !eligibleForRattrapage(grades.filter((g) => g.subjectId === subjectId), studentId)) {
                errors[studentId] = 'Pas de rattrapage : moyenne supérieure ou égale à 10, ou notes pas encore validées.';
            } else plan.push({ studentId, existing, value: Math.round(number * 100) / 100 });
        });
        fail(errors, 'Certaines notes sont invalides : rien n\'a été enregistré.');

        const newId = idSequence('grd', grades, 4);
        let saved = 0;
        let removed = 0;
        plan.forEach(({ studentId, existing, value, remove }) => {
            if (remove) { grades.splice(grades.indexOf(existing), 1); removed += 1; return; }
            if (existing) {
                if (existing.value !== value) saved += 1;
                Object.assign(existing, { value, enteredBy: actor.id, enteredAt: todayISO() });
            } else {
                grades.push({
                    id: newId(), studentId, subjectId, type, value, status: 'brouillon',
                    enteredBy: actor.id, enteredAt: todayISO(), validatedBy: null, validatedAt: null,
                });
                saved += 1;
            }
        });
        await replaceAll('grades', grades);
        return { saved, removed };
    },

    /** Valide (et verrouille) tous les brouillons d'une évaluation. Retourne { validated }. */
    async validate({ subjectId, type }, actor) {
        const [subjects, grades] = await Promise.all([list('subjects'), list('grades')]);
        const subject = subjects.find((s) => s.id === subjectId);
        if (!subject) throw new ValidationError('Matière introuvable.');
        assertCanGrade(subject, actor);
        const drafts = grades.filter((g) => g.subjectId === subjectId && g.type === type && g.status === 'brouillon');
        if (!drafts.length) throw new ValidationError('Aucune note en brouillon à valider pour cette évaluation.');
        drafts.forEach((g) => Object.assign(g, { status: 'validee', validatedBy: actor.id, validatedAt: todayISO() }));
        await replaceAll('grades', grades);
        return { validated: drafts.length };
    },

    /** Notes validées d'un étudiant, de la plus récente à la plus ancienne, avec matière et enseignant. */
    async studentHistory(studentId) {
        const [grades, subjects, teachers] = await Promise.all([list('grades'), list('subjects'), list('teachers')]);
        return grades
            .filter((g) => g.studentId === studentId && g.status === 'validee')
            .sort((a, b) => b.validatedAt.localeCompare(a.validatedAt) || a.subjectId.localeCompare(b.subjectId))
            .map((g) => {
                const subject = subjects.find((s) => s.id === g.subjectId);
                return { ...g, subject, teacher: teachers.find((t) => t.id === subject?.teacherId) ?? null };
            });
    },
};

// ---- Bulletins -----------------------------------------------------------------------------------

/**
 * États d'un bulletin pour un étudiant :
 *  - generated  : bulletin généré, identique aux résultats actuels ;
 *  - outdated   : bulletin généré, mais des notes (ou le classement) ont changé depuis : à régénérer ;
 *  - ready      : relevé complet (toutes les matières ont une moyenne), bulletin pas encore généré ;
 *  - incomplete : il manque des notes validées.
 */
export const BULLETIN_STATUS = {
    generated: 'Généré',
    outdated: 'À régénérer',
    ready: 'Prêt à générer',
    incomplete: 'Incomplet',
};

async function loadBulletinContext(semester) {
    const [students, subjects, grades, bulletins, levels, filieres, users, units, rattrapageOpen] = await Promise.all([
        list('students'), list('subjects'), list('grades'), list('bulletins'), list('levels'), list('filieres'), list('users'), list('units'),
        EventService.rattrapageOpen(),
    ]);
    return { students, subjects, grades, bulletins, levels, filieres, users, units, rattrapageOpen, semester };
}

const classSubjectsOf = (ctx, levelId) => ctx.subjects.filter((s) => s.levelId === levelId && s.semester === ctx.semester);

/** Relevés de toute une classe (même matières, même ordre) : base du rang et des moyennes de classe. */
function classmatesOf(ctx, levelId) {
    const subjects = classSubjectsOf(ctx, levelId);
    return ctx.students.filter((s) => s.levelId === levelId).map((student) => ({
        studentId: student.id,
        report: buildReport({
            subjects, grades: ctx.grades.filter((g) => g.studentId === student.id), rattrapageOpen: ctx.rattrapageOpen,
            units: ctx.units.filter((u) => u.levelId === levelId && u.semester === ctx.semester),
        }),
    }));
}

/** Une ligne par étudiant : relevé actuel, bulletin stocké éventuel, état et matières sans moyenne. */
function overviewRows(ctx) {
    const byLevel = new Map();
    return ctx.students.map((student) => {
        if (!byLevel.has(student.levelId)) byLevel.set(student.levelId, classmatesOf(ctx, student.levelId));
        const classmates = byLevel.get(student.levelId);
        const report = classmates.find((c) => c.studentId === student.id).report;
        const bulletin = ctx.bulletins.find((b) => b.studentId === student.id && b.semester === ctx.semester) ?? null;
        const live = report.complete ? bulletinSnapshot({ report, classmates }) : null;
        let status;
        if (bulletin) status = live && sameResults(bulletin, live) ? 'generated' : 'outdated';
        else status = report.complete ? 'ready' : 'incomplete';
        return {
            student, report, bulletin, status, live,
            missing: report.lines.filter((l) => l.average === null).map((l) => ({ code: l.code, name: l.name })),
        };
    });
}

export const BulletinService = {
    list: async ({ studentId } = {}) => {
        const items = await list('bulletins');
        return studentId ? items.filter((b) => b.studentId === studentId) : items;
    },
    async count() {
        return (await list('bulletins')).length;
    },

    /** Vue d'ensemble pour le chef : une ligne par étudiant (voir BULLETIN_STATUS). */
    async overview(semester = config.CURRENT_SEMESTER) {
        return overviewRows(await loadBulletinContext(semester));
    },

    /**
     * Relevé calculé "en direct" depuis les notes validées (le bulletin stocké, lui, est un instantané
     * généré à une date donnée). Retourne { student, report, bulletin|null }.
     */
    async getReport(studentId, semester = config.CURRENT_SEMESTER) {
        const ctx = await loadBulletinContext(semester);
        const row = overviewRows(ctx).find((r) => r.student.id === studentId);
        return row ? { student: row.student, report: row.report, bulletin: row.bulletin } : null;
    },

    /**
     * Génère (ou régénère) des bulletins. Réservé au chef de département.
     * studentIds : liste ciblée ; absent = tous les étudiants « prêts » ou « à régénérer ».
     * Un étudiant au relevé incomplet est ignoré et listé dans skipped avec la raison.
     * Retourne { generated, regenerated, skipped: [{ student, reason }] }.
     */
    async generate({ studentIds = null, semester = config.CURRENT_SEMESTER } = {}, actor) {
        if (actor?.role !== 'chef') throw new ValidationError('Seul le chef de département peut générer les bulletins.');
        const ctx = await loadBulletinContext(semester);
        const rows = overviewRows(ctx).filter((r) => (studentIds ? studentIds.includes(r.student.id) : ['ready', 'outdated'].includes(r.status)));
        const next = idSequence('blt', ctx.bulletins);
        const result = { generated: 0, regenerated: 0, skipped: [] };
        rows.forEach((row) => {
            if (!row.live) {
                result.skipped.push({ student: row.student, reason: `il manque la moyenne de ${row.missing.map((m) => m.code).join(', ')}` });
                return;
            }
            if (row.status === 'generated') { result.skipped.push({ student: row.student, reason: 'bulletin déjà à jour' }); return; }
            const fields = {
                studentId: row.student.id, semester, academicYear: config.ACADEMIC_YEAR,
                ...row.live, generatedAt: todayISO(), generatedBy: actor.id,
            };
            if (row.bulletin) { Object.assign(row.bulletin, fields); result.regenerated += 1; }
            else { ctx.bulletins.push({ id: next(), ...fields }); result.generated += 1; }
        });
        if (!result.generated && !result.regenerated && studentIds && result.skipped.length) {
            throw new ValidationError(`Génération impossible : ${result.skipped[0].reason}.`);
        }
        await replaceAll('bulletins', ctx.bulletins);
        return result;
    },

    /**
     * Tout ce qu'il faut pour la page d'un bulletin : état, matières sans moyenne, document (null tant qu'il
     * n'est pas généré). Retourne null si l'étudiant n'existe pas.
     */
    async detail(studentId, semester = config.CURRENT_SEMESTER) {
        const ctx = await loadBulletinContext(semester);
        const row = overviewRows(ctx).find((r) => r.student.id === studentId);
        if (!row) return null;
        const level = ctx.levels.find((l) => l.id === row.student.levelId);
        const filiere = ctx.filieres.find((f) => f.id === level.filiereId);
        return {
            student: row.student,
            cls: { levelName: level.name, levelLabel: level.label, filiere: filiere.name, label: `${level.label} · ${filiere.name}` },
            status: row.status,
            missing: row.missing,
            report: row.report,
            document: row.bulletin ? documentOf(ctx, row) : null,
        };
    },

    /**
     * Document complet d'un bulletin généré (pour l'affichage et le PDF), ou null s'il n'existe pas encore.
     * outdated = true si des notes ont changé depuis la génération.
     */
    async getDocument(studentId, semester = config.CURRENT_SEMESTER) {
        const ctx = await loadBulletinContext(semester);
        const row = overviewRows(ctx).find((r) => r.student.id === studentId);
        return row?.bulletin ? documentOf(ctx, row) : null;
    },
};

/** Assemble le document d'un bulletin : instantané + identité, classe, signataire et barème. */
function documentOf(ctx, row) {
    const level = ctx.levels.find((l) => l.id === row.student.levelId);
    const filiere = ctx.filieres.find((f) => f.id === level.filiereId);
    const chief = ctx.users.find((u) => u.role === 'chef');
    return {
        ...row.bulletin,
        number: row.bulletin.id.toUpperCase(),
        student: row.student,
        cls: {
            levelName: level.name, levelLabel: level.label, filiere: filiere.name, label: `${level.label} · ${filiere.name}`,
            cycle: level.name[0] === 'M' ? { fr: 'MASTER', en: 'MASTER' } : { fr: 'LICENCE', en: 'BACHELOR' },
        },
        institution: INSTITUTION,
        department: config.DEPARTMENT,
        appName: config.APP_NAME,
        chief: chief ? { firstName: chief.firstName, lastName: chief.lastName } : null,
        grading: { cc: WEIGHTS.CC, exam: WEIGHTS.EXAMEN, passMark: PASS_MARK, mentions: MENTIONS },
        outdated: row.status === 'outdated',
    };
}
