/*
 * Génère le jeu de données de démonstration dans assets/mock/*.json.
 *
 *   node tools/generate-mock.mjs
 *
 * Déterministe (PRNG à graine fixe) : relancer le script donne exactement les mêmes fichiers.
 * Les JSON sont versionnés et font office de contrat d'API : on ne dépend pas de ce script à l'exécution.
 * Scénario : année 2026-2027, semestre S1 terminé, session normale passée, "aujourd'hui" = 2027-01-25.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, bulletinSnapshot, hoursSummary } from '../assets/js/utils/calculs.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'mock');
const TODAY = '2027-01-25';
const YEAR = '2026-2027';
const SEMESTER = 'S1';
const PASSWORD = 'demo1234'; // mock uniquement
const DOMAIN = 'dept-info.demo';

// ---- Utilitaires ------------------------------------------------------------

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(20262027);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const pad = (n, w) => String(n).padStart(w, '0');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const dateAdd = (iso, days) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
};
const weekday = (iso) => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }; // 1=lundi

// ---- Référentiels -----------------------------------------------------------

const filieres = [
    { id: 'fil-gl', code: 'GL', name: 'Génie Logiciel' },
    { id: 'fil-rt', code: 'RT', name: 'Réseaux et Télécommunications' },
    { id: 'fil-ds', code: 'DS', name: 'Data Science et IA' },
];

const levelDefs = [
    { code: 'L2', label: 'Licence 2' },
    { code: 'L3', label: 'Licence 3' },
    { code: 'M1', label: 'Master 1' },
];
// Chiffre du niveau dans le matricule : L1..L3 = 1..3, M1 = 4, M2 = 5
const levelDigit = (name) => (name[0] === 'L' ? Number(name[1]) : 3 + Number(name[1]));
const levels = filieres.flatMap((f) =>
    levelDefs.map((l) => ({ id: `lvl-${f.code.toLowerCase()}-${l.code.toLowerCase()}`, name: l.code, label: l.label, filiereId: f.id })));

// contractHours = volume horaire dû sur le semestre
const teacherDefs = [
    ['Samuel', 'Nkoulou', 'Professeur', 180],
    ['Brigitte', 'Mbarga', 'Maître de conférences', 150],
    ['Armand', 'Tchoua', 'Maître de conférences', 165],
    ['Clarisse', 'Fotso', 'Chargé de cours', 120],
    ['Hervé', 'Kamga', 'Maître de conférences', 180],
    ['Patrick', 'Essomba', 'Chargé de cours', 135],
    ['Estelle', 'Ngono', 'Maître de conférences', 135],
    ['Joseph', 'Atangana', 'Professeur', 105],
    ['Didier', 'Nana', 'Vacataire', 150],
    ['Mireille', 'Tagne', 'Maître de conférences', 150],
    ['Alain', 'Mballa', 'Chargé de cours', 105],
    ['Sandrine', 'Ndongo', 'Chargé de cours', 105],
    ['Fabrice', 'Biyaga', 'Maître de conférences', 150],
    ['Rodrigue', 'Onana', 'Vacataire', 150],
];
// probabilité d'absence par enseignant (index 1..14) ; par défaut 3 %
const absenceRate = { 1: 0, 8: 0.14, 12: 0.1, 14: 0.09, 6: 0.05 };
const photos = ['user_1.jpg', 'user_2.jpg', 'user_3.jpg', 'user_4.jpg', 'user_5.jpg', 'user_6.jpg', 'user_7.jpg', 'user_8.jpg'];

const teachers = teacherDefs.map(([firstName, lastName, grade, contractHours], i) => ({
    id: `tea-${pad(i + 1, 3)}`,
    firstName, lastName, grade,
    email: `${slug(firstName)}.${slug(lastName)}@${DOMAIN}`,
    phone: `+237 6${pick([55, 75, 77, 90, 99])} ${pad(Math.floor(rand() * 100), 2)} ${pad(Math.floor(rand() * 100), 2)} ${pad(Math.floor(rand() * 100), 2)}`,
    contractHours,
    photo: `assets/images/${photos[i % photos.length]}`,
}));
const tid = (n) => `tea-${pad(n, 3)}`;

// [classe, code, intitulé, coefficient, heures prévues, n° enseignant]
const subjectDefs = {
    'lvl-gl-l2': [
        ['INF201', 'Algorithmique avancée', 4, 60, 1],
        ['INF202', 'Programmation orientée objet', 4, 60, 11],
        ['INF203', 'Bases de données relationnelles', 3, 45, 2],
        ['MAT201', 'Mathématiques discrètes', 3, 45, 4],
        ['ANG201', 'Anglais technique', 1, 30, 9],
    ],
    'lvl-gl-l3': [
        ['GL301', 'Génie logiciel et UML', 4, 60, 1],
        ['GL302', 'Développement web avancé', 4, 60, 6],
        ['GL303', 'Administration des bases de données', 3, 45, 2],
        ['GL304', "Systèmes d'exploitation", 3, 45, 7],
        ['COM301', 'Communication professionnelle', 1, 30, 9],
    ],
    'lvl-gl-m1': [
        ['GL401', 'Architecture logicielle', 4, 60, 1],
        ['GL402', 'Développement mobile', 3, 45, 11],
        ['GL403', 'DevOps et intégration continue', 3, 45, 14],
        ['GL404', 'Gestion de projet agile', 3, 45, 12],
        ['GL405', 'Cybersécurité applicative', 3, 45, 8],
    ],
    'lvl-rt-l2': [
        ['RT201', 'Architecture des ordinateurs', 3, 45, 7],
        ['RT202', 'Fondamentaux des réseaux', 4, 60, 3],
        ['RT203', 'Électronique numérique', 3, 45, 13],
        ['MAT202', 'Probabilités et statistiques', 3, 45, 10],
        ['ANG202', 'Anglais technique', 1, 30, 9],
    ],
    'lvl-rt-l3': [
        ['RT301', 'Routage et commutation', 4, 60, 3],
        ['RT302', 'Administration Linux', 3, 45, 7],
        ['RT303', 'Transmission et télécommunications', 4, 60, 13],
        ['RT304', 'Programmation réseau', 3, 45, 6],
        ['COM302', 'Communication professionnelle', 1, 30, 9],
    ],
    'lvl-rt-m1': [
        ['RT401', 'Sécurité des réseaux', 4, 60, 8],
        ['RT402', 'Virtualisation et cloud', 3, 45, 14],
        ['RT403', 'Réseaux mobiles 4G/5G', 3, 45, 13],
        ['RT404', 'Supervision et qualité de service', 3, 45, 3],
        ['RT405', 'Gestion de projet', 2, 30, 12],
    ],
    'lvl-ds-l2': [
        ['DS201', 'Algorithmique et Python', 4, 60, 5],
        ['DS202', 'Statistiques descriptives', 3, 45, 10],
        ['DS203', 'Bases de données', 3, 45, 2],
        ['MAT203', 'Algèbre linéaire', 3, 45, 4],
        ['ANG203', 'Anglais technique', 1, 30, 9],
    ],
    'lvl-ds-l3': [
        ['DS301', 'Apprentissage automatique', 4, 60, 5],
        ['DS302', 'Probabilités appliquées', 3, 45, 10],
        ['DS303', 'Entrepôts de données', 3, 45, 2],
        ['DS304', 'Visualisation de données', 2, 30, 6],
        ['COM303', 'Communication professionnelle', 1, 30, 9],
    ],
    'lvl-ds-m1': [
        ['DS401', 'Apprentissage profond', 4, 60, 5],
        ['DS402', 'Big Data et traitement distribué', 4, 60, 14],
        ['DS403', 'Traitement du langage naturel', 3, 45, 5],
        ['DS404', 'Éthique et gouvernance des données', 2, 30, 12],
        ['DS405', 'Statistiques bayésiennes', 3, 45, 10],
    ],
};

let subjectSeq = 0;
const subjects = levels.flatMap((lvl) =>
    subjectDefs[lvl.id].map(([code, name, coefficient, plannedHours, t]) => ({
        id: `sub-${pad(++subjectSeq, 3)}`,
        code, name, coefficient, plannedHours,
        levelId: lvl.id, semester: SEMESTER, teacherId: tid(t),
    })));

// Unités d'enseignement : par classe, UE1 (fondamentale) = 3 premières matières, UE2 (complémentaire) = les suivantes
const units = [];
levels.forEach((lvl) => {
    const fil = filieres.find((f) => f.id === lvl.filiereId);
    const own = subjects.filter((s) => s.levelId === lvl.id);
    [['UEF', own.slice(0, 3)], ['UEC', own.slice(3)]].forEach(([type, list], i) => {
        if (!list.length) return;
        const unit = { id: `ue-${pad(units.length + 1, 3)}`, code: `UE${i + 1}${fil.code}${levelDigit(lvl.name)}`, name: `Unité d'enseignements ${i + 1}`, type, levelId: lvl.id, semester: SEMESTER };
        units.push(unit);
        list.forEach((s) => { s.unitId = unit.id; });
    });
});

// ---- Étudiants ----------------------------------------------------------------

const firstNames = ['Aïcha', 'Brice', 'Carine', 'Cédric', 'Danielle', 'Éric', 'Flore', 'Gaëlle', 'Hugues', 'Ines', 'Jules', 'Karelle', 'Landry', 'Mélanie', 'Nadège', 'Olivier', 'Prisca', 'Quentin', 'Rosine', 'Steve', 'Thérèse', 'Ulrich', 'Vanessa', 'Wilfried', 'Yvan', 'Zoé', 'Arnaud', 'Béatrice', 'Christian', 'Delphine', 'Elvis', 'Fanny', 'Guy', 'Huguette', 'Idriss', 'Joëlle', 'Kevin', 'Laure', 'Martial', 'Noémie', 'Octave', 'Pauline', 'Rodolphe', 'Sylvie', 'Tatiana', 'Valérie', 'Yannick', 'Axel', 'Bertille', 'Cyrille', 'Dorine', 'Emmanuel', 'Francine', 'Gilles'];
const lastNames = ['Abena', 'Bekolo', 'Chendjou', 'Djomo', 'Eboa', 'Fouda', 'Gwet', 'Hiag', 'Kenfack', 'Lekane', 'Manga', 'Ndzana', 'Owona', 'Pouemi', 'Sime', 'Talla', 'Um Nyobe', 'Wamba', 'Zambo', 'Assiga', 'Bella', 'Choupo', 'Dongmo', 'Etoundi', 'Feudjio', 'Guiffo', 'Ketchanga', 'Lontsi', 'Mvondo', 'Njoya', 'Olinga', 'Pekeu', 'Tchinda', 'Yimga', 'Zang', 'Amougou', 'Biloa', 'Ebogo', 'Fokou', 'Kouam', 'Mbida', 'Ngassa', 'Ondoua', 'Takam', 'Voufo', 'Wouapi', 'Youmbi', 'Atemengue', 'Belinga', 'Cheuko', 'Djeumou', 'Eyenga', 'Foning', 'Kamdem'];
const shuffled = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fn = shuffled(firstNames);
const ln = shuffled(lastNames);

const STUDENTS_PER_CLASS = 6;
const birthYear = { L2: 2005, L3: 2004, M1: 2003 };
// Flux dédié : l'ajout du lieu de naissance ne doit pas décaler le reste du jeu de données
const randPlace = mulberry32(99);
const cities = ['Yaoundé', 'Douala', 'Bafoussam', 'Garoua', 'Ngaoundéré', 'Bamenda', 'Bertoua', 'Maroua', 'Ebolowa', 'Buea', 'Kribi', 'Limbé', 'Dschang', 'Bafia', 'Edéa'];
const students = [];
levels.forEach((lvl, li) => {
    const fil = filieres.find((f) => f.id === lvl.filiereId);
    for (let k = 0; k < STUDENTS_PER_CLASS; k++) {
        const n = students.length;
        const firstName = fn[n % fn.length];
        const lastName = ln[(n * 7 + li) % ln.length];
        students.push({
            id: `stu-${pad(n + 1, 3)}`,
            matricule: `26${fil.code}${levelDigit(lvl.name)}${pad(k + 1, 3)}`,
            firstName, lastName,
            birthDate: `${birthYear[lvl.name] - (rand() < 0.3 ? 1 : 0)}-${pad(1 + Math.floor(rand() * 12), 2)}-${pad(1 + Math.floor(rand() * 28), 2)}`,
            birthPlace: cities[Math.floor(randPlace() * cities.length)],
            email: `${slug(firstName)}.${slug(lastName)}@etu.${DOMAIN}`,
            phone: `+237 6${pick([55, 75, 77, 90, 99])} ${pad(Math.floor(rand() * 100), 2)} ${pad(Math.floor(rand() * 100), 2)} ${pad(Math.floor(rand() * 100), 2)}`,
            filiereId: fil.id,
            levelId: lvl.id,
            photo: `assets/images/${photos[n % photos.length]}`,
        });
    }
});
// unicité des e-mails (collisions possibles de noms)
const seenEmail = new Set();
students.forEach((s) => {
    let e = s.email, i = 2;
    while (seenEmail.has(e)) e = s.email.replace('@', `${i++}@`);
    s.email = e; seenEmail.add(e);
});

// ---- Utilisateurs -------------------------------------------------------------

// Le chef de département est le SEUL compte : enseignants et étudiants sont des fiches sans connexion.
const users = [
    { id: 'usr-chef', email: `chef@${DOMAIN}`, password: PASSWORD, role: 'chef', firstName: 'Gaston', lastName: 'Nzogang', photo: 'assets/images/avatar.png', demo: true, active: true, mustChangePassword: false },
];
// Nombre de comptes de l'ancienne version (chef + enseignants + étudiants) : sert à garder le même nombre de tirages aléatoires,
// donc les mêmes séances et notes générées ensuite.
const LEGACY_USER_COUNT = 1 + teachers.length + students.length;

// ---- Événements ---------------------------------------------------------------

const eventDefs = [
    ['autre', 'Rentrée académique 2026-2027', '2026-09-14', null, 'Amphi A', null, null, '2026-09-01'],
    ['reunion', 'Réunion pédagogique de mi-semestre', '2026-11-04', null, 'Salle des profs', '15:00', '17:00', '2026-10-20'],
    ['cc', 'Contrôles continus du semestre 1', '2026-11-16', '2026-11-20', 'Salles de cours', null, null, '2026-10-26'],
    ['autre', 'Journée portes ouvertes', '2026-12-05', null, 'Campus', null, null, '2026-11-15'],
    ['session_normale', 'Session normale — semestre 1', '2027-01-11', '2027-01-22', 'Amphis A et B', null, null, '2026-11-30'],
    ['reunion', 'Conseil de département', '2027-01-21', null, 'Salle du conseil', '10:00', '12:00', '2027-01-10'],
    ['reunion', 'Délibérations du semestre 1', '2027-01-28', null, 'Salle du conseil', '14:00', '17:00', '2027-01-20'],
    ['autre', 'Remise des bulletins du semestre 1', '2027-01-29', null, 'Secrétariat', null, null, '2027-01-20'],
    ['autre', 'Début du semestre 2', '2027-02-01', null, null, null, null, '2027-01-15'],
    ['rattrapage', 'Session de rattrapage — semestre 1', '2027-02-08', '2027-02-12', 'Amphis A et B', null, null, '2027-01-18'],
    ['stage', 'Stages de fin de cycle (L3 et M1)', '2027-03-01', '2027-05-28', 'Entreprises partenaires', null, null, '2027-01-12'],
    ['cc', 'Contrôles continus du semestre 2', '2027-03-22', '2027-03-26', 'Salles de cours', null, null, '2027-01-12'],
    ['autre', 'Forum entreprises', '2027-04-10', null, 'Campus', null, null, '2027-01-12'],
    ['session_normale', 'Session normale — semestre 2', '2027-06-07', '2027-06-18', 'Amphis A et B', null, null, '2027-01-12'],
    ['rattrapage', 'Session de rattrapage — semestre 2', '2027-07-05', '2027-07-09', 'Amphis A et B', null, null, '2027-01-12'],
];
const events = eventDefs.map(([type, title, start, end, location, startTime, endTime, createdAt], i) => ({
    id: `evt-${pad(i + 1, 3)}`,
    type, title, start, end, startTime, endTime, location,
    description: null,
    createdBy: 'usr-chef',
    createdAt,
}));

// Notifications (rappels) : événements proches (de -5 j à +20 j autour d'aujourd'hui), pour le chef
const notifications = [];
const notifEvents = events.filter((e) => e.start >= dateAdd(TODAY, -5) && e.start <= dateAdd(TODAY, 20));
notifEvents.forEach((e) => {
    for (let u = 0; u < LEGACY_USER_COUNT; u++) {
        const isPast = e.start < TODAY;
        // Un tirage par ancien compte (le chef est le premier) : le flux aléatoire reste identique à celui de l'ancienne version,
        // donc les séances et notes générées ensuite ne changent pas.
        const read = isPast ? rand() < 0.8 : rand() < 0.15;
        if (u !== 0) continue;
        notifications.push({
            id: `ntf-${pad(notifications.length + 1, 4)}`,
            userId: 'usr-chef',
            eventId: e.id,
            message: e.title,
            read,
            createdAt: `${e.createdAt}T09:00:00`,
        });
    }
});

// ---- Séances (heures et présences) -------------------------------------------

const slots = [
    { id: 'A', start: '08:00', end: '10:00', h: 2 }, { id: 'B', start: '10:15', end: '12:15', h: 2 },
    { id: 'C', start: '14:00', end: '16:00', h: 2 }, { id: 'D', start: '16:15', end: '18:15', h: 2 },
    { id: 'E', start: '08:00', end: '11:00', h: 3 }, { id: 'F', start: '14:00', end: '17:00', h: 3 },
];
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const overlap = (a, b) => mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end);

// 15 semaines de cours : 14 du 14/09 au 18/12, puis la semaine du 04/01 (vacances entre les deux)
const weekStarts = [];
for (let k = 0; k < 14; k++) weekStarts.push(dateAdd('2026-09-14', 7 * k));
weekStarts.push('2027-01-04');

// Emploi du temps hebdomadaire : sans conflit pour un enseignant ni pour une classe
const busy = new Map(); // clé enseignant|classe -> [{day, slot}]
const isFree = (key, day, slot) => !(busy.get(key) || []).some((b) => b.day === day && overlap(b.slot, slot));
const take = (key, day, slot) => busy.set(key, [...(busy.get(key) || []), { day, slot }]);

const timetable = []; // { subject, day, slot }
subjects.forEach((sub) => {
    const perWeek = sub.plannedHours === 60 ? 2 : 1;
    const needed = sub.plannedHours === 45 ? 3 : 2;
    const usedDays = new Set();
    for (let n = 0; n < perWeek; n++) {
        const candidates = shuffled(slots.filter((s) => s.h === needed));
        const days = shuffled([1, 2, 3, 4, 5]).filter((d) => !usedDays.has(d));
        let placed = false;
        for (const day of days) {
            for (const slot of candidates) {
                if (isFree(sub.teacherId, day, slot) && isFree(sub.levelId, day, slot)) {
                    take(sub.teacherId, day, slot); take(sub.levelId, day, slot);
                    timetable.push({ subject: sub, day, slot });
                    usedDays.add(day);
                    placed = true; break;
                }
            }
            if (placed) break;
        }
        if (!placed) throw new Error(`Emploi du temps impossible pour ${sub.code}`);
    }
});

const absenceReasons = ['Mission à l\'extérieur', 'Maladie', 'Empêchement personnel', 'Raison non communiquée', 'Séminaire de recherche'];
// Flux aléatoire dédié : changer le scénario d'absences ne modifie pas les autres collections.
const randSessions = mulberry32(7);
// Scénario : les absences sont plus fréquentes jusqu'à mi-décembre (x1,6) puis reculent nettement (x0,25)
// => les cartes « heures / absences / présences » du chef montrent une PROGRESSION.
const absenceFactor = (weekIndex) => (weekIndex < 11 ? 1.6 : 0.25);
const sessions = [];
// Démonstration du contrôle : une séance de la dernière semaine n'est pas encore enregistrée pour trois enseignants en heures
// supplémentaires (leur bilan ne change pas de catégorie) : elle apparaît « à confirmer » dans l'emploi du temps.
const unconfirmedSubjects = new Set(['tea-005', 'tea-009', 'tea-010'].map((tid) => subjects.find((s) => s.teacherId === tid).id));
weekStarts.forEach((ws, weekIndex) => {
    timetable.forEach(({ subject, day, slot }) => {
        const date = dateAdd(ws, day - 1);
        const teacherNo = Number(subject.teacherId.slice(4));
        const absent = randSessions() < (absenceRate[teacherNo] ?? 0.03) * absenceFactor(weekIndex);
        const reason = absenceReasons[Math.floor(randSessions() * absenceReasons.length)];
        if (weekIndex === weekStarts.length - 1 && unconfirmedSubjects.delete(subject.id)) return; // tirages déjà faits : flux inchangé
        sessions.push({
            id: `ses-${pad(sessions.length + 1, 4)}`,
            teacherId: subject.teacherId,
            subjectId: subject.id,
            date, startTime: slot.start, endTime: slot.end,
            status: absent ? 'absent' : 'present',
            declaredBy: 'usr-chef',
            note: absent ? reason : null,
        });
    });
});
sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
sessions.forEach((s, i) => { s.id = `ses-${pad(i + 1, 4)}`; });

// ---- Emploi du temps (créneaux hebdomadaires) ---------------------------------------------
// Les créneaux sont exactement la grille qui a produit les séances ci-dessus : l'emploi du temps et les séances restent cohérents.
// Les salles sont attribuées sans conflit (aucun tirage aléatoire : les autres données ne changent pas).
const ROOMS = ['Amphi A', 'Amphi B', 'Salle 101', 'Salle 102', 'Salle 103', 'Salle 201', 'Salle 202', 'Salle 203', 'Labo Info 1', 'Labo Info 2'];
const SEMESTER_FIRST_DAY = '2026-09-14';
const SEMESTER_LAST_DAY = '2027-01-08'; // la session normale commence le 11/01
const timetableSlots = timetable.map(({ subject, day, slot }, i) => {
    let room = null;
    for (let k = 0; k < ROOMS.length && !room; k++) {
        const candidate = ROOMS[(i + k) % ROOMS.length];
        if (isFree(`room:${candidate}`, day, slot)) { take(`room:${candidate}`, day, slot); room = candidate; }
    }
    if (!room) throw new Error(`Aucune salle libre pour ${subject.code}`);
    return { id: `slt-${pad(i + 1, 3)}`, subjectId: subject.id, weekday: day, startTime: slot.start, endTime: slot.end, room, validFrom: SEMESTER_FIRST_DAY, validUntil: SEMESTER_LAST_DAY };
});
// Vacances de fin d'année : aucun cours les deux semaines du 21/12 et du 28/12 (séances annulées, pas « à confirmer »)
const timetableExceptions = [];
timetableSlots.forEach((sl) => ['2026-12-21', '2026-12-28'].forEach((weekStart) => {
    timetableExceptions.push({ slotId: sl.id, date: dateAdd(weekStart, sl.weekday - 1), reason: 'Vacances de fin d\'année' });
}));

// ---- Notes ----------------------------------------------------------------------

// État de la saisie de l'examen par matière : défaut "validee"
const examState = {
    GL302: 'brouillon', // saisi mais pas encore validé par l'enseignant
    RT401: 'brouillon',
    DS403: 'none',      // pas encore saisi
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const quarter = (v) => Math.round(v * 4) / 4;

// Flux aléatoire dédié aux notes (GRADES_SEED) : indépendant des autres collections.
const GRADES_SEED = 5;
const randG = mulberry32(GRADES_SEED);
const betweenG = (lo, hi) => lo + randG() * (hi - lo);
const ability = new Map(students.map((s) => [s.id, randG() < 0.15 ? betweenG(13.5, 16) : randG() < 0.2 ? betweenG(6.5, 9.5) : betweenG(9.5, 13.5)]));
const grades = [];
const addGrade = (student, subject, type, value, status, enteredAt, validatedAt) => {
    grades.push({
        id: `grd-${pad(grades.length + 1, 4)}`,
        studentId: student.id, subjectId: subject.id, type,
        value, status,
        enteredBy: 'usr-chef',
        enteredAt,
        validatedBy: status === 'validee' ? 'usr-chef' : null,
        validatedAt: status === 'validee' ? validatedAt : null,
    });
};
const subjectsOf = (levelId) => subjects.filter((s) => s.levelId === levelId);
students.forEach((st) => {
    subjectsOf(st.levelId).forEach((sub) => {
        const base = ability.get(st.id);
        // CC : saisi et validé début décembre ; ~3 % d'absents sans note
        if (randG() > 0.03) {
            addGrade(st, sub, 'CC', quarter(clamp(base + betweenG(-2.5, 2.5), 3, 19.5)), 'validee', '2026-12-02', '2026-12-04');
        }
        // Examen : janvier
        const state = examState[sub.code] ?? 'validee';
        if (state !== 'none' && randG() > 0.02) {
            addGrade(st, sub, 'EXAMEN', quarter(clamp(base + betweenG(-3.5, 3), 2, 19.5)), state, '2027-01-23', '2027-01-25');
        }
    });
});

// ---- Bulletins ---------------------------------------------------------------------

// Classes dont le secrétariat a déjà généré les bulletins ; les autres classes complètes restent à générer
const generatedFor = new Set(['lvl-gl-l2', 'lvl-gl-m1', 'lvl-rt-l2', 'lvl-ds-l3']);
const rattrapageOpen = events.some((e) => e.type === 'rattrapage' && e.start > TODAY && e.title.includes('semestre 1'));
const bulletins = [];
levels.forEach((lvl) => {
    if (!generatedFor.has(lvl.id)) return;
    // Relevés de toute la classe : nécessaires au rang et aux moyennes de classe
    const classmates = students.filter((s) => s.levelId === lvl.id).map((st) => ({
        studentId: st.id,
        report: buildReport({ subjects: subjectsOf(lvl.id), grades: grades.filter((g) => g.studentId === st.id), rattrapageOpen, units: units.filter((u) => u.levelId === lvl.id) }),
    }));
    classmates.filter((c) => c.report.complete).forEach(({ studentId, report }) => {
        bulletins.push({
            id: `blt-${pad(bulletins.length + 1, 3)}`,
            studentId, semester: SEMESTER, academicYear: YEAR,
            ...bulletinSnapshot({ report, classmates }),
            generatedAt: '2027-01-25',
            generatedBy: 'usr-chef',
        });
    });
});

// Compte étudiant de démo : un étudiant ADMIS avec bulletin généré et des résultats contrastés
// (au moins une matière sous 10 et une au-dessus), pour que les tableaux de bord montrent les deux cas.
// ---- Contrôles d'intégrité ---------------------------------------------------------

const ids = (arr) => new Set(arr.map((x) => x.id));
const check = (label, values, set) => {
    const bad = values.filter((v) => v !== null && !set.has(v));
    if (bad.length) throw new Error(`Référence cassée (${label}) : ${[...new Set(bad)].slice(0, 5).join(', ')}`);
};
check('student.levelId', students.map((s) => s.levelId), ids(levels));
check('student.filiereId', students.map((s) => s.filiereId), ids(filieres));
check('level.filiereId', levels.map((l) => l.filiereId), ids(filieres));
check('subject.teacherId', subjects.map((s) => s.teacherId), ids(teachers));
check('subject.levelId', subjects.map((s) => s.levelId), ids(levels));
check('grade.studentId', grades.map((g) => g.studentId), ids(students));
check('grade.subjectId', grades.map((g) => g.subjectId), ids(subjects));
check('session.subjectId', sessions.map((s) => s.subjectId), ids(subjects));
check('session.teacherId', sessions.map((s) => s.teacherId), ids(teachers));
check('slot.subjectId', timetableSlots.map((t) => t.subjectId), ids(subjects));
check('exception.slotId', timetableExceptions.map((x) => x.slotId), ids(timetableSlots));
check('bulletin.studentId', bulletins.map((b) => b.studentId), ids(students));
check('notification.userId', notifications.map((n) => n.userId), ids(users));
check('notification.eventId', notifications.map((n) => n.eventId), ids(events));
if (new Set(users.map((u) => u.email)).size !== users.length) throw new Error('E-mails utilisateurs en double');

// ---- Écriture -------------------------------------------------------------------------

const collections = { users, filieres, levels, units, students, teachers, subjects, grades, bulletins, sessions, timetableSlots, timetableExceptions, events, notifications };
mkdirSync(OUT, { recursive: true });
for (const [name, items] of Object.entries(collections)) {
    // un enregistrement par ligne : fichiers lisibles et diffs propres
    const body = '[\n' + items.map((i) => '  ' + JSON.stringify(i)).join(',\n') + '\n]\n';
    writeFileSync(join(OUT, `${name}.json`), body);
}

// ---- Rapport -------------------------------------------------------------------------
console.log('Collections :', Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length])));
console.log('\nHeures par enseignant (S1) :');
teachers.forEach((t) => {
    const h = hoursSummary({ teacher: t, subjects, sessions, period: `${SEMESTER}-${YEAR}` });
    const abs = sessions.filter((s) => s.teacherId === t.id && s.status === 'absent').length;
    console.log(`  ${t.id} ${(t.firstName + ' ' + t.lastName).padEnd(22)} prévues ${String(h.planned).padStart(3)}  réalisées ${String(h.done).padStart(6)}  contrat ${String(h.contract).padStart(3)}  sup ${String(h.overtime).padStart(5)}  manquantes ${String(h.missing).padStart(5)}  absences ${abs}`);
});
const reportByClass = levels.map((l) => {
    const sts = students.filter((s) => s.levelId === l.id);
    const reps = sts.map((st) => buildReport({ subjects: subjectsOf(l.id), grades: grades.filter((g) => g.studentId === st.id), rattrapageOpen }));
    const avgs = reps.filter((r) => r.complete).map((r) => r.average);
    return `  ${l.id.padEnd(10)} complets ${avgs.length}/${sts.length}  moyenne ${avgs.length ? (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : '—'}  résultats ${reps.map((r) => r.result[0]).join('')}`;
});
console.log('\nPar classe (A=Admis R=Rattrapage I=Incomplet J=Ajourné) :\n' + reportByClass.join('\n'));
console.log('\nBulletins générés :', bulletins.length);
console.log('Comptes de démo :', users.filter((u) => u.demo).map((u) => `${u.role} ${u.email}`).join(' | '), `(mot de passe : ${PASSWORD})`);
