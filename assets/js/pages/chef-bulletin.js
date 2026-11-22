/* Chef : bulletin d'un étudiant (?student=stu-001) : aperçu, génération / régénération, PDF, impression. */

import { url } from '../config.js';
import { initPage } from '../layout.js';
import { initBulletinPage } from '../components/bulletin-page.js';

const ctx = await initPage({ role: 'chef', page: 'bulletins' });

if (ctx) {
    await initBulletinPage({
        studentId: new URLSearchParams(window.location.search).get('student'),
        actor: { id: ctx.user.id, role: ctx.user.role },
        listUrl: url('pages/chef/bulletins.html'),
    });
}
