import { initPage } from '../layout.js';
import { mountProfilePage } from '../components/profile-page.js';

const ctx = await initPage({ role: 'chef', page: 'profile' });
if (ctx) await mountProfilePage(ctx);
