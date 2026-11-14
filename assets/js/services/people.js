/*
 * Référentiels et personnes : filières, niveaux, étudiants, enseignants.
 *
 * Les écritures (create / update / remove) valident les données et appliquent les règles d'intégrité
 * qu'appliquera le backend : e-mail unique, compte utilisateur synchronisé, suppression en cascade ou refusée.
 * Elles lèvent une ValidationError (message général + messages par champ) que les formulaires affichent.
 */

import { config } from '../config.js';
import { addDays, todayISO } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { nextId } from './ids.js';
import { request, requestOrNull } from './api.js';

const enc = encodeURIComponent;

const DEFAULT_PASSWORD = 'demo1234'; // mock uniquement : le backend générera / enverra un mot de passe temporaire
const DEFAULT_PHOTO = 'assets/images/avatar.png';
export const TEACHER_GRADES = ['Professeur', 'Maître de conférences', 'Chargé de cours', 'Vacataire'];

const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const text = (value) => String(value ?? '').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ]{6,18}$/;

/** Contrôles communs à toutes les personnes ; retourne les erreurs par champ. */
function validateIdentity(input, users, ownUserId) {
    const errors = {};
    if (text(input.firstName).length < 2) errors.firstName = 'Le prénom est obligatoire (2 caractères minimum).';
    if (text(input.lastName).length < 2) errors.lastName = 'Le nom est obligatoire (2 caractères minimum).';
    const email = text(input.email).toLowerCase();
    if (!EMAIL.test(email)) errors.email = "L'adresse e-mail n'est pas valide.";
    else if (users.some((u) => u.id !== ownUserId && u.email.toLowerCase() === email)) errors.email = 'Cette adresse e-mail est déjà utilisée.';
    if (text(input.birthPlace).length > 60) errors.birthPlace = 'Lieu de naissance trop long (60 caractères maximum).';
    if (text(input.phone) && !PHONE.test(text(input.phone))) errors.phone = 'Numéro invalide (chiffres et espaces, ex. +237 677 12 34 56).';
    return errors;
}

function fail(errors, message = 'Veuillez corriger les champs signalés.') {
    if (Object.keys(errors).length) throw new ValidationError(message, errors);
}

/** Répercute nom, prénom et e-mail sur le compte de connexion associé à un profil. */
function syncUser(users, profile) {
    const user = users.find((u) => u.profileId === profile.id);
    if (user) Object.assign(user, { firstName: profile.firstName, lastName: profile.lastName, email: profile.email });
}

export const ReferenceService = {
    filieres: () => (config.USE_MOCK ? list('filieres') : request('GET', '/filieres')),
    levels: () => (config.USE_MOCK ? list('levels') : request('GET', '/levels')),
    /** Unités d'enseignement (UE) ; filtrables par classe et semestre. */
    async units({ levelId, semester } = {}) {
        if (!config.USE_MOCK) return request('GET', '/units', { query: { levelId, semester } });
        let items = await list('units');
        if (levelId) items = items.filter((u) => u.levelId === levelId);
        if (semester) items = items.filter((u) => u.semester === semester);
        return items;
    },

    /** Classes (niveau + filière) : { id, name, filiereId, filiere, label: "L3 · Génie Logiciel", short: "L3 GL" }. */
    async classes() {
        if (!config.USE_MOCK) return request('GET', '/classes');
        const [levels, filieres] = await Promise.all([list('levels'), list('filieres')]);
        return levels.map((level) => {
            const filiere = filieres.find((f) => f.id === level.filiereId);
            return { ...level, filiere, label: `${level.name} · ${filiere.name}`, short: `${level.name} ${filiere.code}` };
        });
    },

    /** Libellé d'une classe : "L3 · Génie Logiciel". */
    async classLabel(levelId) {
        return (await this.classes()).find((c) => c.id === levelId)?.label ?? '—';
    },
};

export const StudentService = {
    /** filters : { filiereId, levelId, q } (q = recherche sur nom, prénom, matricule, e-mail). */
    async list({ filiereId, levelId, q } = {}) {
        if (!config.USE_MOCK) return request('GET', '/students', { query: { filiereId, levelId, q } });
        let items = await list('students');
        if (filiereId) items = items.filter((s) => s.filiereId === filiereId);
        if (levelId) items = items.filter((s) => s.levelId === levelId);
        if (q) {
            const needle = normalize(q);
            items = items.filter((s) => normalize(`${s.firstName} ${s.lastName} ${s.matricule} ${s.email}`).includes(needle));
        }
        return items;
    },
    async get(id) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/students/${enc(id)}`);
        return (await list('students')).find((s) => s.id === id) ?? null;
    },
    async count() {
        if (!config.USE_MOCK) return (await request('GET', '/students/count')).count;
        return (await list('students')).length;
    },

    /** Date de naissance la plus récente acceptée (15 ans minimum) : sert aussi d'attribut max du formulaire. */
    latestBirthDate: () => addDays(todayISO(), -15 * 365),

    async create(input) {
        if (!config.USE_MOCK) return request('POST', '/students', { body: input });
        const [students, users, levels, filieres] = await Promise.all([list('students'), list('users'), list('levels'), list('filieres')]);
        const errors = validateIdentity(input, users, null);
        const level = levels.find((l) => l.id === input.levelId);
        if (!level) errors.levelId = 'Choisissez un niveau.';
        validateBirthDate(input.birthDate, errors);
        fail(errors);

        const filiere = filieres.find((f) => f.id === level.filiereId);
        // Chiffre du niveau : L1..L3 = 1..3, M1 = 4, M2 = 5
        const digit = level.name[0] === 'L' ? Number(level.name[1]) : 3 + Number(level.name[1]);
        const prefix = `${config.ACADEMIC_YEAR.slice(2, 4)}${filiere.code}${digit}`;
        const lastSeq = students.filter((s) => s.matricule.startsWith(prefix)).reduce((m, s) => Math.max(m, Number(s.matricule.slice(prefix.length)) || 0), 0);
        const id = nextId('stu', students);
        const student = {
            id,
            matricule: `${prefix}${String(lastSeq + 1).padStart(3, '0')}`,
            firstName: text(input.firstName), lastName: text(input.lastName),
            birthDate: input.birthDate, birthPlace: text(input.birthPlace),
            email: text(input.email).toLowerCase(), phone: text(input.phone),
            filiereId: level.filiereId, levelId: level.id,
            photo: DEFAULT_PHOTO,
        };
        users.push({
            id: `usr-${id}`, email: student.email, password: DEFAULT_PASSWORD, role: 'etudiant', profileId: id,
            firstName: student.firstName, lastName: student.lastName, photo: student.photo, demo: false, active: true, mustChangePassword: true,
        });
        students.push(student);
        await Promise.all([replaceAll('students', students), replaceAll('users', users)]);
        return { ...student, temporaryPassword: DEFAULT_PASSWORD, emailSent: false }; // comme l'API : mot de passe à communiquer
    },

    async update(id, input) {
        if (!config.USE_MOCK) return request('PUT', `/students/${enc(id)}`, { body: input });
        const [students, users, levels, grades] = await Promise.all([list('students'), list('users'), list('levels'), list('grades')]);
        const student = students.find((s) => s.id === id);
        if (!student) throw new ValidationError('Étudiant introuvable.');
        const errors = validateIdentity(input, users, `usr-${id}`);
        const level = levels.find((l) => l.id === input.levelId);
        if (!level) errors.levelId = 'Choisissez un niveau.';
        else if (level.id !== student.levelId && grades.some((g) => g.studentId === id)) {
            errors.levelId = 'Changement de classe impossible : cet étudiant a déjà des notes.';
        }
        validateBirthDate(input.birthDate, errors);
        fail(errors);

        Object.assign(student, {
            firstName: text(input.firstName), lastName: text(input.lastName), birthDate: input.birthDate, birthPlace: text(input.birthPlace),
            email: text(input.email).toLowerCase(), phone: text(input.phone), filiereId: level.filiereId, levelId: level.id,
        });
        syncUser(users, student);
        await Promise.all([replaceAll('students', students), replaceAll('users', users)]);
        return student;
    },

    /** Ce que supprimer un étudiant entraîne (affiché dans la confirmation). */
    async removalImpact(id) {
        if (!config.USE_MOCK) return request('GET', `/students/${enc(id)}/removal-impact`);
        const [grades, bulletins] = await Promise.all([list('grades'), list('bulletins')]);
        return { grades: grades.filter((g) => g.studentId === id).length, bulletins: bulletins.filter((b) => b.studentId === id).length };
    },

    /** Supprime l'étudiant, son compte, ses notes, ses bulletins et ses notifications. */
    async remove(id) {
        if (!config.USE_MOCK) { await request('DELETE', `/students/${enc(id)}`); return; }
        const [students, users, grades, bulletins, notifications] = await Promise.all([
            list('students'), list('users'), list('grades'), list('bulletins'), list('notifications'),
        ]);
        if (!students.some((s) => s.id === id)) throw new ValidationError('Étudiant introuvable.');
        const userId = `usr-${id}`;
        await Promise.all([
            replaceAll('students', students.filter((s) => s.id !== id)),
            replaceAll('users', users.filter((u) => u.id !== userId)),
            replaceAll('grades', grades.filter((g) => g.studentId !== id)),
            replaceAll('bulletins', bulletins.filter((b) => b.studentId !== id)),
            replaceAll('notifications', notifications.filter((n) => n.userId !== userId)),
        ]);
    },
};

function validateBirthDate(value, errors) {
    if (!value || Number.isNaN(Date.parse(value))) errors.birthDate = 'La date de naissance est obligatoire.';
    else if (value > StudentService.latestBirthDate()) errors.birthDate = "L'étudiant doit avoir au moins 15 ans.";
    else if (value < '1940-01-01') errors.birthDate = 'Date de naissance invraisemblable.';
}

export const TeacherService = {
    list: () => (config.USE_MOCK ? list('teachers') : request('GET', '/teachers')),
    async get(id) {
        if (!config.USE_MOCK) return requestOrNull('GET', `/teachers/${enc(id)}`);
        return (await list('teachers')).find((t) => t.id === id) ?? null;
    },

    async create(input) {
        if (!config.USE_MOCK) return request('POST', '/teachers', { body: input });
        const [teachers, users] = await Promise.all([list('teachers'), list('users')]);
        const errors = { ...validateIdentity(input, users, null), ...validateTeacherFields(input) };
        fail(errors);

        const id = nextId('tea', teachers);
        const teacher = {
            id,
            firstName: text(input.firstName), lastName: text(input.lastName), grade: input.grade,
            email: text(input.email).toLowerCase(), phone: text(input.phone),
            contractHours: Number(input.contractHours),
            photo: DEFAULT_PHOTO,
        };
        users.push({
            id: `usr-${id}`, email: teacher.email, password: DEFAULT_PASSWORD, role: 'enseignant', profileId: id,
            firstName: teacher.firstName, lastName: teacher.lastName, photo: teacher.photo, demo: false, active: true, mustChangePassword: true,
        });
        teachers.push(teacher);
        await Promise.all([replaceAll('teachers', teachers), replaceAll('users', users)]);
        return { ...teacher, temporaryPassword: DEFAULT_PASSWORD, emailSent: false };
    },

    async update(id, input) {
        if (!config.USE_MOCK) return request('PUT', `/teachers/${enc(id)}`, { body: input });
        const [teachers, users] = await Promise.all([list('teachers'), list('users')]);
        const teacher = teachers.find((t) => t.id === id);
        if (!teacher) throw new ValidationError('Enseignant introuvable.');
        fail({ ...validateIdentity(input, users, `usr-${id}`), ...validateTeacherFields(input) });

        Object.assign(teacher, {
            firstName: text(input.firstName), lastName: text(input.lastName), grade: input.grade,
            email: text(input.email).toLowerCase(), phone: text(input.phone), contractHours: Number(input.contractHours),
        });
        syncUser(users, teacher);
        await Promise.all([replaceAll('teachers', teachers), replaceAll('users', users)]);
        return teacher;
    },

    /** Matières attribuées et séances enregistrées : ce qui empêche la suppression. */
    async usage(id) {
        if (!config.USE_MOCK) return request('GET', `/teachers/${enc(id)}/usage`);
        const [subjects, sessions] = await Promise.all([list('subjects'), list('sessions')]);
        return { subjects: subjects.filter((s) => s.teacherId === id), sessions: sessions.filter((s) => s.teacherId === id).length };
    },

    /** Refusée si l'enseignant a des matières ou un historique de séances (intégrité des références). */
    async remove(id) {
        if (!config.USE_MOCK) { await request('DELETE', `/teachers/${enc(id)}`); return; }
        const [teachers, users, notifications, checkins] = await Promise.all([list('teachers'), list('users'), list('notifications'), list('checkins')]);
        if (!teachers.some((t) => t.id === id)) throw new ValidationError('Enseignant introuvable.');
        const usage = await this.usage(id);
        if (usage.subjects.length || usage.sessions) {
            const parts = [];
            if (usage.subjects.length) parts.push(`${usage.subjects.length} matière${usage.subjects.length > 1 ? 's' : ''} attribuée${usage.subjects.length > 1 ? 's' : ''}`);
            if (usage.sessions) parts.push(`${usage.sessions} séance${usage.sessions > 1 ? 's' : ''} enregistrée${usage.sessions > 1 ? 's' : ''}`);
            throw new ValidationError(`Suppression impossible : cet enseignant a ${parts.join(' et ')}. Réattribuez ses matières d'abord.`);
        }
        const userId = `usr-${id}`;
        await Promise.all([
            replaceAll('teachers', teachers.filter((t) => t.id !== id)),
            replaceAll('users', users.filter((u) => u.id !== userId)),
            replaceAll('notifications', notifications.filter((n) => n.userId !== userId)),
            replaceAll('checkins', checkins.filter((c) => c.teacherId !== id)),
        ]);
    },
};

function validateTeacherFields(input) {
    const errors = {};
    if (!TEACHER_GRADES.includes(input.grade)) errors.grade = 'Choisissez un grade.';
    const hours = Number(input.contractHours);
    if (input.contractHours === '' || input.contractHours === null || input.contractHours === undefined || !Number.isInteger(hours) || hours < 0 || hours > 500) {
        errors.contractHours = 'Entrez un nombre entier d\'heures entre 0 et 500.';
    }
    return errors;
}
