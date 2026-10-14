const screens = [...document.querySelectorAll('.screen')];
const toast = document.querySelector('.toast');
let toastTimeout;

function showScreen(screenName) {
	screens.forEach((screen) => {
		const isActive = screen.id === screenName;
		screen.classList.toggle('is-active', isActive);
		screen.setAttribute('aria-hidden', String(!isActive));
	});
}

function showMessage(message) {
	toast.textContent = message;
	toast.classList.add('visible');
	window.clearTimeout(toastTimeout);
	toastTimeout = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

document.querySelectorAll('[data-screen]').forEach((button) => {
	button.addEventListener('click', () => showScreen(button.dataset.screen));
});

document.querySelectorAll('[data-message]').forEach((button) => {
	button.addEventListener('click', (event) => {
		if (button.tagName === 'A') event.preventDefault();
		showMessage(button.dataset.message);
	});
});

document.querySelectorAll('.role-option').forEach((button) => {
	button.addEventListener('click', () => {
		document.querySelectorAll('.role-option').forEach((option) => {
			const isSelected = option === button;
			option.classList.toggle('selected', isSelected);
			option.setAttribute('aria-pressed', String(isSelected));
		});
	});
});

document.querySelector('#login-form').addEventListener('submit', (event) => {
	event.preventDefault();
	showScreen('dashboard');
});

const accountForm = document.querySelector('#account-form');
const accountPassword = document.querySelector('#account-password');
const confirmPassword = document.querySelector('#confirm-password');

function validatePasswordMatch() {
	confirmPassword.setCustomValidity(confirmPassword.value === accountPassword.value ? '' : 'Passwords do not match.');
}

accountPassword.addEventListener('input', validatePasswordMatch);
confirmPassword.addEventListener('input', validatePasswordMatch);

accountForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const firstName = new FormData(accountForm).get('fullName').trim().split(/\s+/)[0];
	document.querySelector('#dashboard-title').innerHTML = `Hi, ${firstName}<span class="period">.</span>`;
	showScreen('dashboard');
});

showScreen('login');
