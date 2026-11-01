/*
 * Présence géolocalisée (« Marquer ma présence »).
 *
 * Règles de gestion (projet.md §8, « Présence géolocalisée ») :
 *  - seul l'enseignant marque SA présence, pour une de SES matières, le jour même (une fois par matière et par jour) ;
 *  - la position de l'appareil doit être précise (≤ CHECKIN_MAX_ACCURACY m) et à moins de `radiusMeters` de l'établissement ;
 *  - seules la distance, la précision, la date et l'heure sont conservées, PAS les coordonnées (minimisation des données) ;
 *  - une présence marquée n'est pas une séance : elle ne compte pas dans les heures. Elle ajoute le repère « géolocalisée » à la
 *    séance déclarée le même jour pour la même matière (SessionService.detailed → `verified`).
 * Ces contrôles sont refaits ici car le backend DOIT les refaire : une position envoyée par un navigateur peut être falsifiée
 * (simulateur, extension) ; le serveur calcule la distance lui-même et reste seul juge.
 */

import { config, INSTITUTION } from '../config.js';
import { distanceMeters, formatDistance } from '../utils/geo.js';
import { todayISO } from '../utils/format.js';
import { list, replaceAll } from './data.js';
import { ValidationError } from './errors.js';
import { idSequence } from './ids.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function clock() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export const PresenceService = {
    /** Position et rayon de l'établissement. */
    institution: () => ({ ...INSTITUTION.location }),

    /** Présences marquées, de la plus récente à la plus ancienne, avec la matière. Filtres : teacherId, from, to. */
    async list({ teacherId, from, to } = {}) {
        const [checkins, subjects] = await Promise.all([list('checkins'), list('subjects')]);
        return checkins
            .filter((c) => (!teacherId || c.teacherId === teacherId) && (!from || c.date >= from) && (!to || c.date <= to))
            .map((c) => ({ ...c, subject: subjects.find((s) => s.id === c.subjectId) ?? null }))
            .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    },

    /**
     * Marque la présence de l'enseignant. position : { lat, lng, accuracy }.
     * Retourne { id, teacherId, subjectId, date, time, distance, accuracy } ; refuse avec un message précis sinon.
     */
    async checkIn({ subjectId, lat, lng, accuracy }, actor) {
        if (actor?.role !== 'enseignant') throw new ValidationError('Seul l\'enseignant peut marquer sa présence.');
        const [subjects, checkins] = await Promise.all([list('subjects'), list('checkins')]);
        const subject = subjects.find((s) => s.id === subjectId);
        if (!subject) throw new ValidationError('Choisissez la matière concernée.', { subjectId: 'Choisissez la matière concernée.' });
        if (subject.teacherId !== actor.profileId) throw new ValidationError("Cette matière ne vous est pas attribuée.", { subjectId: "Cette matière ne vous est pas attribuée." });

        const date = todayISO();
        const already = checkins.find((c) => c.teacherId === actor.profileId && c.subjectId === subjectId && c.date === date);
        if (already) throw new ValidationError(`Présence déjà marquée aujourd'hui à ${already.time} pour cette matière.`, { subjectId: `Déjà marquée à ${already.time}.` });

        if (!finite(lat) || !finite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !finite(accuracy) || accuracy < 0) {
            throw new ValidationError('Position invalide : réessayez la localisation.');
        }
        if (accuracy > config.CHECKIN_MAX_ACCURACY) {
            throw new ValidationError(`Précision insuffisante (±${Math.round(accuracy)} m, ${config.CHECKIN_MAX_ACCURACY} m maximum). Rapprochez-vous d'une fenêtre ou réessayez à l'extérieur.`);
        }
        const { radiusMeters, name, ...center } = INSTITUTION.location;
        const distance = Math.round(distanceMeters({ lat, lng }, center));
        if (distance > radiusMeters) {
            throw new ValidationError(`Vous êtes à ${formatDistance(distance)} de ${name} (rayon autorisé : ${radiusMeters} m). Rendez-vous sur le campus pour marquer votre présence.`);
        }

        const next = idSequence('chk', checkins, 4);
        const checkin = { id: next(), teacherId: actor.profileId, subjectId, date, time: clock(), distance, accuracy: Math.round(accuracy) };
        await replaceAll('checkins', [...checkins, checkin]);
        return checkin;
    },
};
