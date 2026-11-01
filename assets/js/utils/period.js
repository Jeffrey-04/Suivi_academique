/*
 * Sélecteur de période (bouton « .btn-date-picker » du template + Flatpickr en mode plage).
 * La page doit contenir le bouton #date-picker-trigger avec un <span id="selected-date-range">
 * et charger assets/libs/flatpickr/flatpickr.min.js (+ .css) avant son module.
 */

import { formatDate, toISODate } from './format.js';

export const FR_LOCALE = {
    firstDayOfWeek: 1,
    weekdays: {
        shorthand: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
        longhand: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
    },
    months: {
        shorthand: ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
        longhand: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    },
    rangeSeparator: ' au ',
    weekAbbreviation: 'Sem',
    scrollTitle: 'Défiler pour augmenter la valeur',
    toggleTitle: 'Cliquer pour basculer',
    ordinal: (n) => (n > 1 ? '' : 'er'),
};

/**
 * @param {{ start: string, end: string, min?: string, max?: string, onChange: (range: {from: string, to: string}) => void }} options
 * Dates en "YYYY-MM-DD". onChange n'est appelé que lorsque la plage est complète (début ET fin choisis).
 */
export function initPeriodPicker({ start, end, min, max, onChange }) {
    const trigger = document.getElementById('date-picker-trigger');
    const label = document.getElementById('selected-date-range');
    if (!trigger || !label) return null;
    if (typeof flatpickr === 'undefined') {
        console.error("Flatpickr n'est pas chargé sur cette page.");
        return null;
    }

    const show = (from, to) => { label.textContent = to ? `${formatDate(from)} – ${formatDate(to)}` : `${formatDate(from)} – …`; };
    show(start, end);

    return flatpickr(trigger, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        defaultDate: [start, end],
        minDate: min,
        maxDate: max,
        locale: FR_LOCALE,
        onChange(dates) {
            if (dates.length === 1) {
                show(toISODate(dates[0]));
            } else if (dates.length === 2) {
                const [from, to] = dates.map(toISODate);
                show(from, to);
                onChange({ from, to });
            }
        },
    });
}
