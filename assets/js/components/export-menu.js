/*
 * Bouton « Exporter » avec choix du format : classeur Excel (recommandé, mis en forme) ou CSV.
 * La page fournit getSpec() (voir utils/exporter.js) ; retourner null signale « rien à exporter ».
 */

import { toast } from '../utils/dialogs.js';
import { exportSpec } from '../utils/exporter.js';

let sequence = 0;

/**
 * @param {HTMLElement} container élément qui reçoit le menu
 * @param {{ getSpec: () => (object|null|Promise<object|null>) }} options
 */
export function mountExportMenu(container, { getSpec }) {
    const id = `export-${++sequence}`;
    container.innerHTML = `
      <div class="dropdown">
        <button class="btn-table-action dropdown-toggle" type="button" id="${id}" data-bs-toggle="dropdown" aria-expanded="false">
          <i class="bi bi-file-earmark-arrow-down"></i> <span>Exporter</span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end dropdown-menu-custom" aria-labelledby="${id}">
          <li><button type="button" class="dropdown-item" data-format="xlsx"><i class="bi bi-file-earmark-excel"></i><span>Classeur Excel (.xlsx)<small>Mis en forme, prêt à imprimer</small></span></button></li>
          <li><button type="button" class="dropdown-item" data-format="csv"><i class="bi bi-filetype-csv"></i><span>Fichier CSV<small>Séparateur « ; », pour import</small></span></button></li>
        </ul>
      </div>`;
    const toggle = container.querySelector('.dropdown-toggle');

    container.addEventListener('click', async (event) => {
        const item = event.target.closest('[data-format]');
        if (!item) return;
        const format = item.dataset.format;
        toggle.disabled = true;
        toggle.querySelector('span').textContent = 'Export en cours…';
        try {
            const spec = await getSpec();
            if (!spec) { toast("Rien à exporter avec les filtres actuels.", { type: 'info' }); return; }
            const filename = await exportSpec(spec, format);
            const rows = spec.sheets[0].rows.length;
            toast(`${filename} exporté (${rows} ligne${rows > 1 ? 's' : ''}).`);
        } catch (error) {
            console.error(error);
            toast("L'export a échoué. Réessayez.", { type: 'danger' });
        } finally {
            toggle.disabled = false;
            toggle.querySelector('span').textContent = 'Exporter';
        }
    });
    return { toggle };
}
