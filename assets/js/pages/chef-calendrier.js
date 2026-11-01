import { initPage } from '../layout.js';
import { mountCalendarPage } from '../components/calendar-page.js';

const ctx = await initPage({ role: 'chef', page: 'calendar' });
if (ctx) await mountCalendarPage(ctx);
