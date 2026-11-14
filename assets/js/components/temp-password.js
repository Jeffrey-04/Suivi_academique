/*
 * Mot de passe temporaire d'un compte (créé ou réinitialisé par le chef) : affiché UNE seule fois dans une fenêtre.
 * Le serveur l'envoie aussi par e-mail quand le service d'envoi est configuré (emailSent) ; sinon le chef doit le communiquer.
 * Ne jamais le journaliser ni le conserver côté page.
 */

import { openModal, toast } from '../utils/dialogs.js';
import { esc } from '../utils/format.js';

/**
 * @param {{ name: string, email: string, password: string, emailSent: boolean, reset?: boolean }} options
 * @returns {Promise<void>} résolue à la fermeture de la fenêtre
 */
export async function showTemporaryPassword({ name, email, password, emailSent, reset = false }) {
    const how = emailSent
        ? `Un e-mail contenant ce mot de passe a été envoyé à <strong>${esc(email)}</strong>. Conservez-le aussi, il ne sera plus affiché.`
        : `<strong>Aucun e-mail n'a été envoyé</strong> (service d'envoi non configuré ou indisponible) : communiquez ce mot de passe de façon sûre. Il ne sera plus affiché.`;
    const choice = await openModal({
        title: reset ? 'Mot de passe réinitialisé' : 'Compte créé',
        body: `<p class="mb-0">Mot de passe temporaire de <strong>${esc(name)}</strong> :</p>
               <code class="temp-password" aria-label="Mot de passe temporaire">${esc(password)}</code>
               <p class="stat-hint mb-0">${how} La personne devra en choisir un nouveau à sa première connexion.</p>`,
        buttons: [{ id: 'copy', label: 'Copier', className: 'btn-custom-primary' }],
    });
    if (choice === 'copy') {
        try {
            await navigator.clipboard.writeText(password);
            toast('Mot de passe copié.');
        } catch {
            toast('Copie impossible : notez le mot de passe avant de fermer.', { type: 'danger' });
        }
    }
}
