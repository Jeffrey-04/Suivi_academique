/*
 * Agrégats pour les tableaux de bord (séries, répartitions, classements).
 * Ce sont des "vues" sur les collections : avec le backend, chacune deviendra très probablement
 * un point d'accès dédié et les pages continueront de recevoir le même format.
 */

import { config } from '../config.js';
import { buildReport, hoursSummary, mean, presenceRate, round2, sessionHours, weekStart } from '../utils/calculs.js';
import { BulletinService } from './academics.js';
import { EventService } from './calendar.js';
import { list } from './data.js';
import { ReferenceService } from './people.js';
import { request, requestOrNull } from './api.js';

const enc = encodeURIComponent;

const byId = (items) => new Map(items.map((i) => [i.id, i]));
const period = () => `${config.CURRENT_SEMESTER}-${config.ACADEMIC_YEAR}`;
const inRange = (sessions, from, to) => sessions.filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
const values = (grades, type) => grades.filter((g) => g.type === type).map((g) => g.value);

export const StatsService = {
    /** Série hebdomadaire des séances (toutes, ou celles d'un enseignant, sur [from, to]) : heures, absences, taux de présence. */
    async teachingWeekly({ teacherId, from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', '/stats/teaching-weekly', { query: { teacherId, from, to } });
        let sessions = inRange(await list('sessions'), from, to);
        if (teacherId) sessions = sessions.filter((s) => s.teacherId === teacherId);
        const weeks = new Map();
        sessions.forEach((s) => {
            const key = weekStart(s.date);
            const w = weeks.get(key) ?? { week: key, hours: 0, absences: 0, present: 0, sessions: 0 };
            w.sessions += 1;
            if (s.status === 'present') { w.present += 1; w.hours += sessionHours(s); } else { w.absences += 1; }
            weeks.set(key, w);
        });
        return [...weeks.values()]
            .sort((a, b) => a.week.localeCompare(b.week))
            .map((w) => ({ ...w, hours: round2(w.hours), rate: Math.round((w.present / w.sessions) * 1000) / 10 }));
    },

    /** Moyenne des notes validées de contrôle continu et d'examen, par classe. */
    async classAverages() {
        if (!config.USE_MOCK) return request('GET', '/stats/class-averages');
        const [levels, filieres, students, grades] = await Promise.all([list('levels'), list('filieres'), list('students'), list('grades')]);
        const filiereById = byId(filieres);
        const validated = grades.filter((g) => g.status === 'validee');
        return levels.map((level) => {
            const filiere = filiereById.get(level.filiereId);
            const ids = new Set(students.filter((s) => s.levelId === level.id).map((s) => s.id));
            const own = validated.filter((g) => ids.has(g.studentId));
            return {
                levelId: level.id,
                label: `${level.name} ${filiere.code}`,
                name: `${level.label} · ${filiere.name}`,
                cc: mean(values(own, 'CC')),
                exam: mean(values(own, 'EXAMEN')),
            };
        });
    },

    /** Moyenne générale des notes validées : contrôle continu puis examen (progression ou régression entre les deux). */
    async gradeProgress() {
        if (!config.USE_MOCK) return request('GET', '/stats/grade-progress');
        const validated = (await list('grades')).filter((g) => g.status === 'validee');
        return { cc: mean(values(validated, 'CC')), exam: mean(values(validated, 'EXAMEN')) };
    },

    /** Répartition des résultats du semestre + bulletins à générer ou à régénérer. */
    async departmentResults(semester = config.CURRENT_SEMESTER) {
        if (!config.USE_MOCK) return request('GET', '/stats/department-results', { query: { semester } });
        const rows = await BulletinService.overview(semester);
        const counts = { Admis: 0, Rattrapage: 0, Ajourné: 0, Incomplet: 0 };
        rows.forEach((row) => { counts[row.report.result] += 1; });
        return {
            counts,
            total: rows.length,
            pendingBulletins: rows.filter((r) => r.status === 'ready' || r.status === 'outdated').length,
        };
    },

    /** Dernières absences d'enseignants sur [from, to], de la plus récente à la plus ancienne. */
    async recentAbsences(limit = 5, { from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', '/stats/recent-absences', { query: { limit, from, to } });
        const [sessions, teachers, subjects] = await Promise.all([list('sessions'), list('teachers'), list('subjects')]);
        const teacherById = byId(teachers);
        const subjectById = byId(subjects);
        return inRange(sessions, from, to)
            .filter((s) => s.status === 'absent')
            .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))
            .slice(0, limit)
            .map((s) => ({ ...s, hours: sessionHours(s), teacher: teacherById.get(s.teacherId), subject: subjectById.get(s.subjectId) }));
    },

    /**
     * Avancement des heures par enseignant sur [from, to] : réalisées (séances « présent ») / programmées
     * (toutes les séances de la période), les plus en retard d'abord.
     */
    async hoursProgress(limit = 6, { from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', '/stats/hours-progress', { query: { limit, from, to } });
        const [teachers, sessions] = await Promise.all([list('teachers'), list('sessions')]);
        const inPeriod = inRange(sessions, from, to);
        return teachers
            .map((teacher) => {
                const own = inPeriod.filter((s) => s.teacherId === teacher.id);
                const hours = (items) => round2(items.reduce((total, s) => total + sessionHours(s), 0));
                const planned = hours(own);
                const done = hours(own.filter((s) => s.status === 'present'));
                return { teacher, planned, done, percent: planned ? Math.round((done / planned) * 100) : 100 };
            })
            .filter((row) => row.planned > 0)
            .sort((a, b) => a.percent - b.percent)
            .slice(0, limit);
    },

    /**
     * Une ligne par matière pour la liste du chef : classe, enseignant, effectif, état de la saisie des notes.
     * attendu = 2 notes (CC + examen) par étudiant ; rattrapage non compté.
     */
    async subjectRows() {
        if (!config.USE_MOCK) return request('GET', '/stats/subject-rows');
        const [subjects, teachers, students, grades, classes] = await Promise.all([
            list('subjects'), list('teachers'), list('students'), list('grades'), ReferenceService.classes(),
        ]);
        const classById = byId(classes);
        const teacherById = byId(teachers);
        return subjects.map((subject) => {
            const own = grades.filter((g) => g.subjectId === subject.id && g.type !== 'RATTRAPAGE');
            const count = students.filter((s) => s.levelId === subject.levelId).length;
            return {
                subject,
                cls: classById.get(subject.levelId),
                teacher: teacherById.get(subject.teacherId) ?? null,
                students: count,
                expected: count * 2,
                entered: own.length,
                validated: own.filter((g) => g.status === 'validee').length,
            };
        });
    },

    /** Une ligne par enseignant pour la liste : matières, bilan d'heures du semestre, taux de présence, absences. */
    async teacherRows() {
        if (!config.USE_MOCK) return request('GET', '/stats/teacher-rows');
        const [teachers, subjects, sessions] = await Promise.all([list('teachers'), list('subjects'), list('sessions')]);
        return teachers.map((teacher) => {
            const own = sessions.filter((s) => s.teacherId === teacher.id);
            return {
                teacher,
                subjects: subjects.filter((s) => s.teacherId === teacher.id),
                hours: hoursSummary({ teacher, subjects, sessions, period: period() }),
                rate: presenceRate(own),
                absences: own.filter((s) => s.status === 'absent').length,
            };
        });
    },

    /**
     * Suivi des heures par enseignant : sur la période [from, to] (réalisées, programmées = réalisées + absences,
     * absences) et sur le semestre complet (dues, heures supplémentaires, manquantes, via hoursSummary).
     * Retourne { rows, totals }.
     */
    async hoursOverview({ from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', '/stats/hours-overview', { query: { from, to } });
        const [teachers, subjects, sessions] = await Promise.all([list('teachers'), list('subjects'), list('sessions')]);
        const inPeriod = inRange(sessions, from, to);
        const hours = (items) => round2(items.reduce((total, s) => total + sessionHours(s), 0));
        const rows = teachers.map((teacher) => {
            const own = inPeriod.filter((s) => s.teacherId === teacher.id);
            const present = own.filter((s) => s.status === 'present');
            const done = hours(present);
            const scheduled = hours(own);
            const semester = hoursSummary({ teacher, subjects, sessions, period: period() });
            return {
                teacher, done, scheduled, absentHours: round2(scheduled - done), sessions: own.length,
                absences: own.length - present.length, rate: scheduled ? Math.round((done / scheduled) * 1000) / 10 : null,
                contract: semester.contract, planned: semester.planned, semesterDone: semester.done, overtime: semester.overtime, missing: semester.missing,
            };
        });
        const sum = (key) => round2(rows.reduce((total, r) => total + r[key], 0));
        const scheduled = sum('scheduled');
        return {
            rows,
            totals: {
                done: sum('done'), scheduled, absentHours: sum('absentHours'), absences: sum('absences'), sessions: sum('sessions'),
                overtime: sum('overtime'), missing: sum('missing'), rate: scheduled ? Math.round((sum('done') / scheduled) * 1000) / 10 : null,
            },
        };
    },

    /** Dernières séances d'un enseignant sur [from, to]. */
    async recentSessions(teacherId, limit = 5, { from, to } = {}) {
        if (!config.USE_MOCK) return request('GET', `/stats/teachers/${enc(teacherId)}/recent-sessions`, { query: { limit, from, to } });
        const [sessions, subjects] = await Promise.all([list('sessions'), list('subjects')]);
        const subjectById = byId(subjects);
        return inRange(sessions, from, to)
            .filter((s) => s.teacherId === teacherId)
            .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))
            .slice(0, limit)
            .map((s) => ({ ...s, hours: sessionHours(s), subject: subjectById.get(s.subjectId) }));
    },

    /** Vue d'ensemble d'un enseignant : ses matières (moyennes, validation des notes) et répartition des examens. */
    async teacherOverview(teacherId) {
        if (!config.USE_MOCK) return request('GET', `/stats/teachers/${enc(teacherId)}/overview`);
        const [subjects, students, grades, levels, filieres, sessions] = await Promise.all([
            list('subjects'), list('students'), list('grades'), list('levels'), list('filieres'), list('sessions'),
        ]);
        const levelById = byId(levels);
        const filiereById = byId(filieres);
        const own = subjects.filter((s) => s.teacherId === teacherId);
        const rows = own.map((subject) => {
            const level = levelById.get(subject.levelId);
            const entered = grades.filter((g) => g.subjectId === subject.id && g.type !== 'RATTRAPAGE');
            const validated = entered.filter((g) => g.status === 'validee');
            const count = students.filter((s) => s.levelId === subject.levelId).length;
            const done = sessions.filter((s) => s.subjectId === subject.id && s.status === 'present').reduce((t, s) => t + sessionHours(s), 0);
            return {
                subject,
                className: `${level.name} ${filiereById.get(level.filiereId).code}`,
                classLabel: `${level.label} · ${filiereById.get(level.filiereId).name}`,
                students: count,
                expected: count * 2,
                hoursDone: round2(done),
                cc: mean(values(validated, 'CC')),
                exam: mean(values(validated, 'EXAMEN')),
                entered: entered.length,
                validated: validated.length,
            };
        });
        const validatedExams = grades.filter((g) => own.some((s) => s.id === g.subjectId) && g.status === 'validee' && g.type === 'EXAMEN').map((g) => g.value);
        return {
            rows,
            drafts: rows.reduce((total, r) => total + (r.entered - r.validated), 0),
            cc: mean(rows.map((r) => r.cc)),
            exam: mean(rows.map((r) => r.exam)),
            examBands: {
                low: validatedExams.filter((v) => v < 10).length,
                mid: validatedExams.filter((v) => v >= 10 && v < 14).length,
                high: validatedExams.filter((v) => v >= 14).length,
            },
        };
    },

    /** Vue d'ensemble d'un étudiant : relevé, moyenne de sa classe par matière, progression CC -> examen. */
    async studentOverview(studentId, semester = config.CURRENT_SEMESTER) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/stats/students/${enc(studentId)}/overview`, { query: { semester } });
        const [students, subjects, grades, levels, filieres, bulletins, units, rattrapageOpen] = await Promise.all([
            list('students'), list('subjects'), list('grades'), list('levels'), list('filieres'), list('bulletins'), list('units'), EventService.rattrapageOpen(),
        ]);
        const student = students.find((s) => s.id === studentId);
        if (!student) return null;
        const level = levels.find((l) => l.id === student.levelId);
        const filiere = filieres.find((f) => f.id === level.filiereId);
        const classSubjects = subjects.filter((s) => s.levelId === student.levelId && s.semester === semester);
        const classmates = students.filter((s) => s.levelId === student.levelId);

        const classUnits = units.filter((u) => u.levelId === student.levelId && u.semester === semester);
        const reportOf = (id) => buildReport({ subjects: classSubjects, grades: grades.filter((g) => g.studentId === id), rattrapageOpen, units: classUnits });
        const report = reportOf(studentId);
        const classReports = classmates.map((c) => reportOf(c.id));
        const lines = report.lines.map((line, i) => ({
            ...line,
            classAverage: mean(classReports.map((r) => r.lines[i].average)),
            examOrRattrapage: line.rattrapage ?? line.exam,
        }));
        return {
            student,
            className: `${level.label} · ${filiere.name}`,
            report: { ...report, lines },
            bulletin: bulletins.find((b) => b.studentId === studentId && b.semester === semester) ?? null,
            cc: mean(lines.map((l) => l.cc)),
            exam: mean(lines.map((l) => l.examOrRattrapage)),
        };
    },
};
