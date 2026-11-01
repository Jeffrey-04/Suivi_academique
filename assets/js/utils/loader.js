/*
 * Chargement à la demande des bibliothèques lourdes (ExcelJS ~0,9 Mo, jsPDF ~0,4 Mo) : elles ne sont téléchargées
 * qu'au premier export / premier PDF, jamais au chargement d'une page.
 */

import { url } from '../config.js';

const cache = new Map();

export function loadScript(path) {
    if (!cache.has(path)) {
        cache.set(path, new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url(path);
            script.onload = resolve;
            script.onerror = () => { cache.delete(path); reject(new Error(`Impossible de charger ${path}`)); };
            document.head.appendChild(script);
        }));
    }
    return cache.get(path);
}

export async function loadExcelJs() {
    await loadScript('assets/libs/exceljs/exceljs.min.js');
    return window.ExcelJS;
}

/** Retourne le constructeur jsPDF. */
export async function loadJsPdf() {
    await loadScript('assets/libs/jspdf/jspdf.umd.min.js');
    return window.jspdf.jsPDF;
}
