/* Étudiant : son bulletin du semestre (aperçu, PDF, impression) dès qu'il a été généré par le département. */

import { initPage } from '../layout.js';
import { initBulletinPage } from '../components/bulletin-page.js';

const ctx = await initPage({ role: 'etudiant', page: 'bulletin' });

if (ctx) {
    await initBulletinPage({ studentId: ctx.user.profileId, mode: 'etudiant', actor: { id: ctx.user.id, role: ctx.user.role, profileId: ctx.user.profileId } });
}
