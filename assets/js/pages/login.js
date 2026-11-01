/*
 * Page de connexion : formulaire + comptes de démonstration.
 */

import { ROLES, ROOT, url } from '../config.js';
import { AuthService } from '../services/index.js';
import { esc, fullName } from '../utils/format.js';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('btn-submit');
const errorBox = document.getElementById('login-error');

/** Redirection demandée par le garde (?next=...), acceptée seulement si elle reste dans l'application. */
function safeNext() {
    const next = new URLSearchParams(window.location.search).get('next');
    if (!next) return null;
    try {
        const target = new URL(next, window.location.origin);
        const inApp = target.origin === window.location.origin && target.href.startsWith(ROOT) && target.pathname.endsWith('.html');
        return inApp ? target.href : null;
    } catch {
        return null;
    }
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('d-none');
}

// Afficher / masquer le mot de passe
document.getElementById('toggle-password').addEventListener('click', function () {
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    this.querySelector('i').className = visible ? 'bi bi-eye-slash' : 'bi bi-eye';
    this.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.add('d-none');
    form.classList.add('was-validated');
    if (!form.checkValidity()) return;

    submitButton.disabled = true;
    try {
        const user = await AuthService.login(emailInput.value, passwordInput.value);
        window.location.replace(safeNext() ?? url(ROLES[user.role].home));
    } catch (error) {
        showError(error.message || 'Connexion impossible pour le moment.');
        submitButton.disabled = false;
    }
});

async function init() {
    // Déjà connecté : inutile de repasser par le formulaire
    const session = AuthService.getSession();
    if (session && ROLES[session.role]) {
        window.location.replace(url(ROLES[session.role].home));
        return;
    }

    try {
        const accounts = await AuthService.demoAccounts();
        if (!accounts.length) return;
        document.getElementById('demo-account-list').innerHTML = accounts.map((a) => `
            <button type="button" class="demo-account-btn" data-email="${esc(a.email)}" data-password="${esc(a.password)}">
                <i class="bi ${ROLES[a.role].icon}"></i>
                <span class="demo-account-text">
                    <span class="demo-account-role">${esc(ROLES[a.role].label)}</span>
                    <span class="demo-account-name">${esc(fullName(a))}</span>
                </span>
                <i class="bi bi-arrow-right-short demo-account-go"></i>
            </button>`).join('');
        document.getElementById('demo-accounts').classList.remove('d-none');
    } catch (error) {
        console.error(error); // les comptes de démo sont un bonus : le formulaire reste utilisable
    }
}

document.getElementById('demo-account-list').addEventListener('click', (event) => {
    const button = event.target.closest('.demo-account-btn');
    if (!button) return;
    emailInput.value = button.dataset.email;
    passwordInput.value = button.dataset.password;
    form.requestSubmit();
});

init();
