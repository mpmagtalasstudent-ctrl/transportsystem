const screens = [...document.querySelectorAll('.screen')];
const toast = document.querySelector('.toast');
const navigation = document.querySelector('.bottom-nav');
const storageKeys = {
	profile: 'localTransportProfile',
	trips: 'localTransportTrips',
	updates: 'localTransportUpdates',
};
let toastTimeout;
let activeRideFilter = 'upcoming';

function readStored(key, fallback) {
	try {
		const stored = localStorage.getItem(key);
		return stored ? JSON.parse(stored) : fallback;
	} catch {
		return fallback;
	}
}

function writeStored(key, value) {
	localStorage.setItem(key, JSON.stringify(value));
}

let profile = readStored(storageKeys.profile, {
	fullName: 'Passenger',
	email: '',
	mobile: '',
	municipality: '',
	barangay: '',
});
let trips = readStored(storageKeys.trips, []);
let updates = readStored(storageKeys.updates, []);

function showScreen(screenName) {
	screens.forEach((screen) => {
		const isActive = screen.id === screenName;
		screen.classList.toggle('is-active', isActive);
		screen.setAttribute('aria-hidden', String(!isActive));
	});

	const isAuthenticatedView = !['login', 'create'].includes(screenName);
	navigation.hidden = !isAuthenticatedView;
	navigation.querySelectorAll('.nav-item').forEach((item) => {
		const isCurrent = item.dataset.screen === screenName;
		item.classList.toggle('active', isCurrent);
		if (isCurrent) item.setAttribute('aria-current', 'page');
		else item.removeAttribute('aria-current');
	});
}

function showMessage(message) {
	toast.textContent = message;
	toast.classList.add('visible');
	window.clearTimeout(toastTimeout);
	toastTimeout = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function formatDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
	return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function addEmptyState(container, icon, title, description) {
	const iconElement = document.createElement('span');
	iconElement.className = 'empty-state-icon';
	iconElement.setAttribute('aria-hidden', 'true');
	iconElement.textContent = icon;
	const titleElement = document.createElement('strong');
	titleElement.textContent = title;
	const descriptionElement = document.createElement('p');
	descriptionElement.textContent = description;
	container.replaceChildren(iconElement, titleElement, descriptionElement);
	container.className = 'empty-state';
}

function addUpdate(title, message) {
	updates.unshift({ id: Date.now(), title, message, createdAt: new Date().toISOString(), read: false });
	writeStored(storageKeys.updates, updates);
	renderUpdates();
}

function renderDashboard() {
	const now = new Date();
	const monthTrips = trips.filter((trip) => {
		const createdAt = new Date(trip.createdAt);
		return createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear();
	});
	const upcoming = trips.filter((trip) => trip.status === 'Upcoming');
	const spent = trips.filter((trip) => trip.status === 'Completed').reduce((total, trip) => total + trip.fare, 0);
	const stats = document.querySelectorAll('.stats-grid .stat strong');
	stats[0].textContent = String(monthTrips.length);
	stats[1].textContent = `₱${spent.toLocaleString()}`;
	stats[2].textContent = String(upcoming.length);

	const recentTrips = document.querySelector('.empty-trips');
	const latestTrip = [...trips].sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0];
	if (!latestTrip) {
		const icon = document.createElement('span');
		icon.className = 'empty-icon';
		icon.setAttribute('aria-hidden', 'true');
		icon.textContent = '⌁';
		const content = document.createElement('div');
		const title = document.createElement('strong');
		title.textContent = 'None';
		const detail = document.createElement('p');
		detail.textContent = 'Your recent trips will show up here.';
		content.append(title, detail);
		recentTrips.replaceChildren(icon, content);
		recentTrips.className = 'empty-trips';
	} else {
		const content = document.createElement('div');
		content.className = 'recent-trip-summary';
		const title = document.createElement('strong');
		title.textContent = `${latestTrip.pickup} to ${latestTrip.destination}`;
		const detail = document.createElement('p');
		detail.textContent = `${formatDate(latestTrip.pickupAt)} · ${latestTrip.status}`;
		content.append(title, detail);
		recentTrips.replaceChildren(content);
		recentTrips.className = 'empty-trips has-trip';
	}
}

function renderRides() {
	const rideList = document.querySelector('#ride-list');
	const filteredTrips = [...trips]
		.filter((trip) => activeRideFilter === 'upcoming' ? trip.status === 'Upcoming' : trip.status !== 'Upcoming')
		.sort((first, second) => second.pickupAt.localeCompare(first.pickupAt));
	const upcomingCount = trips.filter((trip) => trip.status === 'Upcoming').length;
	document.querySelector('#upcoming-count').textContent = String(upcomingCount);
	document.querySelectorAll('[data-ride-filter]').forEach((button) => {
		const isSelected = button.dataset.rideFilter === activeRideFilter;
		button.classList.toggle('selected', isSelected);
		button.setAttribute('aria-pressed', String(isSelected));
	});

	if (filteredTrips.length === 0) {
		const isUpcoming = activeRideFilter === 'upcoming';
		addEmptyState(rideList, isUpcoming ? '＋' : '◷', isUpcoming ? 'No upcoming rides' : 'No ride history yet', isUpcoming ? 'Book a ride when you are ready to go.' : 'Completed and cancelled rides will appear here.');
		return;
	}

	rideList.className = 'ride-list';
	rideList.replaceChildren(...filteredTrips.map((trip) => {
		const row = document.createElement('article');
		row.className = 'ride-row';
		const details = document.createElement('div');
		const route = document.createElement('h3');
		route.className = 'ride-route';
		route.textContent = `${trip.pickup} to ${trip.destination}`;
		const meta = document.createElement('p');
		meta.className = 'ride-meta';
		meta.textContent = `${formatDate(trip.pickupAt)} · ${trip.rideType}${trip.notes ? ` · ${trip.notes}` : ''}`;
		details.append(route, meta);
		const side = document.createElement('div');
		side.className = 'ride-side';
		const state = document.createElement('span');
		state.className = 'trip-state';
		state.textContent = trip.status;
		side.append(state);
		if (trip.status === 'Upcoming') {
			const cancel = document.createElement('button');
			cancel.type = 'button';
			cancel.className = 'cancel-button';
			cancel.dataset.cancelTrip = String(trip.id);
			cancel.textContent = 'Cancel request';
			side.append(cancel);
		}
		row.append(details, side);
		return row;
	}));
}

function renderUpdates() {
	const list = document.querySelector('#notification-list');
	if (updates.length === 0) {
		addEmptyState(list, '♧', 'You are all caught up', 'Ride requests and account updates will appear here.');
		return;
	}

	list.className = 'notification-list';
	list.replaceChildren(...updates.map((update) => {
		const row = document.createElement('article');
		row.className = `notification-row${update.read ? '' : ' unread'}`;
		const dot = document.createElement('span');
		dot.className = 'notification-dot';
		dot.setAttribute('aria-hidden', 'true');
		const content = document.createElement('div');
		const title = document.createElement('h3');
		title.textContent = update.title;
		const message = document.createElement('p');
		message.textContent = update.message;
		content.append(title, message);
		const date = document.createElement('time');
		date.dateTime = update.createdAt;
		date.textContent = formatDate(update.createdAt, { dateStyle: 'medium' });
		row.append(dot, content, date);
		return row;
	}));
}

function renderProfile() {
	const fields = {
		fullName: '#profile-name',
		mobile: '#profile-mobile',
		email: '#profile-email',
		municipality: '#profile-city',
		barangay: '#profile-barangay',
	};
	Object.entries(fields).forEach(([key, selector]) => {
		document.querySelector(selector).value = profile[key] || '';
	});
	const firstName = profile.fullName?.trim().split(/\s+/)[0] || 'Passenger';
	const greeting = document.querySelector('#dashboard-title');
	const period = document.createElement('span');
	period.className = 'period';
	period.textContent = '.';
	greeting.replaceChildren(document.createTextNode(`Hi, ${firstName}`), period);
	document.querySelector('#dashboard-avatar').textContent = firstName[0].toUpperCase();
	document.querySelector('#profile-avatar').textContent = firstName[0].toUpperCase();
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
	renderProfile();
	renderDashboard();
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
	profile = Object.fromEntries(new FormData(accountForm));
	delete profile.password;
	delete profile.confirmPassword;
	delete profile.terms;
	writeStored(storageKeys.profile, profile);
	renderProfile();
	renderDashboard();
	showScreen('dashboard');
});

const bookForm = document.querySelector('#book-form');
const dateInput = document.querySelector('#pickup-date');
const today = new Date();
dateInput.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

bookForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const formData = new FormData(bookForm);
	const trip = {
		id: Date.now(),
		pickup: formData.get('pickup').trim(),
		destination: formData.get('destination').trim(),
		pickupAt: new Date(`${formData.get('date')}T${formData.get('time')}`).toISOString(),
		rideType: formData.get('rideType'),
		notes: formData.get('notes').trim(),
		status: 'Upcoming',
		fare: 0,
		createdAt: new Date().toISOString(),
	};
	trips.unshift(trip);
	writeStored(storageKeys.trips, trips);
	addUpdate('Ride request created', `Your trip from ${trip.pickup} to ${trip.destination} is in Upcoming rides.`);
	bookForm.reset();
	renderDashboard();
	renderRides();
	showScreen('rides');
	showMessage('Ride request added to Upcoming rides.');
});

document.querySelectorAll('[data-ride-filter]').forEach((button) => {
	button.addEventListener('click', () => {
		activeRideFilter = button.dataset.rideFilter;
		renderRides();
	});
});

document.querySelector('#ride-list').addEventListener('click', (event) => {
	const cancelButton = event.target.closest('[data-cancel-trip]');
	if (!cancelButton) return;
	const trip = trips.find((item) => String(item.id) === cancelButton.dataset.cancelTrip);
	if (!trip) return;
	trip.status = 'Cancelled';
	writeStored(storageKeys.trips, trips);
	addUpdate('Ride request cancelled', `Your trip from ${trip.pickup} to ${trip.destination} was cancelled.`);
	renderDashboard();
	renderRides();
	showMessage('Ride request cancelled.');
});

document.querySelector('#mark-updates-read').addEventListener('click', () => {
	updates = updates.map((update) => ({ ...update, read: true }));
	writeStored(storageKeys.updates, updates);
	renderUpdates();
	showMessage('Updates marked as read.');
});

document.querySelector('#profile-form').addEventListener('submit', (event) => {
	event.preventDefault();
	profile = Object.fromEntries(new FormData(event.currentTarget));
	writeStored(storageKeys.profile, profile);
	renderProfile();
	showMessage('Profile saved.');
});

document.querySelector('#logout-button').addEventListener('click', () => {
	document.querySelector('#login-form').reset();
	showScreen('login');
});

renderProfile();
renderDashboard();
renderRides();
renderUpdates();
showScreen('login');
