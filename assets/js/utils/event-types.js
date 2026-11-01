/*
 * Types d'événements du calendrier académique (analyse, module 5) : libellé, icône et ton de couleur
 * (green | orange | red | neutral). Partagé par les services (validation) et l'affichage.
 */

export const EVENT_TYPES = {
    stage: { label: 'Stage', icon: 'bi-briefcase', tone: 'green' },
    cc: { label: 'Contrôle continu', icon: 'bi-pencil-square', tone: 'orange' },
    session_normale: { label: 'Session normale', icon: 'bi-journal-check', tone: 'red' },
    rattrapage: { label: 'Rattrapage', icon: 'bi-arrow-repeat', tone: 'red' },
    reunion: { label: 'Réunion', icon: 'bi-people', tone: 'neutral' },
    autre: { label: 'Activité du campus', icon: 'bi-calendar-event', tone: 'neutral' },
};

export const eventType = (type) => EVENT_TYPES[type] ?? EVENT_TYPES.autre;

/** Destinataires possibles d'un événement. */
export const AUDIENCES = { chef: 'Chef de département', enseignant: 'Enseignants', etudiant: 'Étudiants' };
