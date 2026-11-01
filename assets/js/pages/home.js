/* Point d'entrée (index.html) : aiguille vers le bon tableau de bord ou vers la connexion. */

import { ROLES, url } from '../config.js';
import { AuthService } from '../services/index.js';

const session = AuthService.getSession();
window.location.replace(url(session && ROLES[session.role] ? ROLES[session.role].home : 'page-login.html'));
