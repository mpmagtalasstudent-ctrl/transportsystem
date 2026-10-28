const screens = [...document.querySelectorAll('.screen')];
const toast = document.querySelector('.toast');
const navigation = document.querySelector('.bottom-nav');
const supabaseClient = window.__LOCAL_TRANSPORT_SUPABASE_CLIENT || (() => {
	const client = window.supabase.createClient(
		window.SUPABASE_CONFIG.url,
		window.SUPABASE_CONFIG.publishableKey,
	);
	window.__LOCAL_TRANSPORT_SUPABASE_CLIENT = client;
	return client;
})();
let toastTimeout;
let activeRideFilter = 'upcoming';
let currentUser = null;
let rideMap;
let activeMapTarget = 'pickup';
let routeLine;
const mapPoints = { pickup: null, destination: null };
const mapMarkers = { pickup: null, destination: null };
const geocodeRequests = { pickup: 0, destination: 0 };

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

function applyTheme(theme) {
	const activeTheme = theme === 'light' ? 'light' : 'dark';
	const isLight = activeTheme === 'light';
	document.documentElement.dataset.theme = activeTheme;
	const toggle = document.querySelector('#theme-toggle');
	const actionLabel = `Switch to ${isLight ? 'dark' : 'light'} mode`;
	toggle.setAttribute('aria-pressed', String(isLight));
	toggle.setAttribute('aria-label', actionLabel);
	toggle.title = actionLabel;
	toggle.querySelector('.theme-toggle-label').textContent = `${activeTheme[0].toUpperCase()}${activeTheme.slice(1)} mode`;
	toggle.querySelector('.theme-toggle-icon').textContent = isLight ? '☾' : '☼';
	document.querySelector('meta[name="theme-color"]').content = isLight ? '#edf4f6' : '#092b45';
	return activeTheme;
}

let profile = {
	fullName: 'Passenger',
	email: '',
	mobile: '',
	municipality: '',
	barangay: '',
};
let trips = [];
let updates = [];

function mapProfileRow(row) {
	return {
		fullName: row.full_name,
		email: row.email,
		mobile: row.mobile,
		municipality: row.municipality,
		barangay: row.barangay,
	};
}

function mapTripRow(row) {
	return {
		id: row.id,
		pickup: row.pickup,
		destination: row.destination,
		pickupAt: row.pickup_at,
		rideType: row.ride_type,
		notes: row.notes,
		status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
		fare: Number(row.fare),
		createdAt: row.created_at,
	};
}

function normalizeRideType(value) {
	const allowedTypes = ['Tricycle', 'Motorcycle', 'Bus', 'Car'];
	const rideType = String(value ?? 'Tricycle').trim();
	return allowedTypes.includes(rideType) ? rideType : 'Tricycle';
}

function mapNotificationRow(row) {
	return {
		id: row.id,
		title: row.title,
		message: row.message,
		createdAt: row.created_at,
		read: row.is_read,
	};
}

async function loadUserData(user) {
	const [profileResult, tripsResult, updatesResult] = await Promise.all([
		supabaseClient.from('profiles').select('*').eq('id', user.id).single(),
		supabaseClient.from('trips').select('*').eq('passenger_id', user.id).order('created_at', { ascending: false }),
		supabaseClient.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
	]);
	if (profileResult.error) throw profileResult.error;
	if (tripsResult.error) throw tripsResult.error;
	if (updatesResult.error) throw updatesResult.error;
	profile = mapProfileRow(profileResult.data);
	trips = tripsResult.data.map(mapTripRow);
	updates = updatesResult.data.map(mapNotificationRow);
	renderProfile();
	renderDashboard();
	renderRides();
	renderUpdates();
}

function clearUserData() {
	currentUser = null;
	profile = { fullName: 'Passenger', email: '', mobile: '', municipality: '', barangay: '' };
	trips = [];
	updates = [];
	renderProfile();
	renderDashboard();
	renderRides();
	renderUpdates();
	showScreen('login');
}

function showScreen(screenName) {
	screens.forEach((screen) => {
		const isActive = screen.id === screenName;
		screen.classList.toggle('is-active', isActive);
		screen.setAttribute('aria-hidden', String(!isActive));
	});
	if (screenName === 'book') {
		requestAnimationFrame(() => {
			initializeRideMap();
			rideMap?.invalidateSize();
		});
	}

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

function setMapTarget(target) {
	activeMapTarget = target;
	document.querySelectorAll('[data-map-target]').forEach((button) => {
		const isSelected = button.dataset.mapTarget === target;
		button.classList.toggle('selected', isSelected);
		button.setAttribute('aria-pressed', String(isSelected));
	});
	document.querySelector('#map-status').textContent = `Click the map to set ${target === 'pickup' ? 'pickup' : 'destination'}.`;
}

function formatAreaName(properties) {
	const area = properties.locality
		|| properties.neighbourhood
		|| properties.suburb
		|| properties.district
		|| properties.city_district
		|| properties.village
		|| properties.town
		|| properties.city
		|| properties.name;
	const city = properties.city || properties.town || properties.village;
	return [...new Set([area, city].filter(Boolean))].join(', ');
}

async function selectMapLocation(latlng) {
	const target = activeMapTarget;
	mapPoints[target] = latlng;
	const coordinates = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
	const input = document.querySelector(target === 'pickup' ? '#pickup-location' : '#dropoff-location');
	input.value = coordinates;
	const pinColor = target === 'pickup' ? '#44d4b4' : '#f3a36f';
	const label = target === 'pickup' ? 'Pickup' : 'Destination';
	if (mapMarkers[target]) mapMarkers[target].remove();
	mapMarkers[target] = L.circleMarker(latlng, {
		radius: 8,
		color: '#ffffff',
		weight: 2,
		fillColor: pinColor,
		fillOpacity: 1,
	}).addTo(rideMap).bindPopup(`${label}: ${coordinates}`);
	if (mapPoints.pickup && mapPoints.destination) {
		const points = [mapPoints.pickup, mapPoints.destination];
		if (routeLine) routeLine.remove();
		routeLine = L.polyline(points, { color: '#168d92', weight: 4, opacity: 0.8, dashArray: '7 8' }).addTo(rideMap);
		rideMap.fitBounds(routeLine.getBounds().pad(0.18), { maxZoom: 15 });
	}
	const status = document.querySelector('#map-status');
	const requestId = ++geocodeRequests[target];
	status.textContent = `Looking up the ${label.toLowerCase()} area…`;
	try {
		const response = await fetch(`https://photon.komoot.io/reverse?lat=${latlng.lat}&lon=${latlng.lng}`);
		if (!response.ok) throw new Error('Area lookup failed');
		const result = await response.json();
		if (geocodeRequests[target] !== requestId) return;
		const properties = result.features?.[0]?.properties;
		const areaName = properties ? formatAreaName(properties) : '';
		if (!areaName) throw new Error('No area found');
		input.value = areaName;
		mapMarkers[target].setPopupContent(`${label}: ${areaName}`);
		status.textContent = `${label} set to ${areaName}. Choose the other location or adjust this point.`;
	} catch {
		if (geocodeRequests[target] !== requestId) return;
		mapMarkers[target].setPopupContent(`${label}: ${coordinates}`);
		status.textContent = `Area lookup unavailable. ${label} coordinates kept as ${coordinates}.`;
	}
}

function initializeRideMap() {
	if (rideMap || !window.L) return;
	rideMap = L.map('ride-map', { scrollWheelZoom: true }).setView([9.31, 123.305], 13);
	const mapContainer = rideMap.getContainer();
	mapContainer.addEventListener('mousedown', (event) => {
		if (event.button === 1) {
			event.preventDefault();
		}
	}, { passive: false });
	mapContainer.addEventListener('auxclick', (event) => {
		if (event.button === 1) {
			event.preventDefault();
		}
	}, { passive: false });
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		maxZoom: 19,
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
	}).addTo(rideMap);
	rideMap.on('click', (event) => selectMapLocation(event.latlng));
}

document.querySelectorAll('[data-map-target]').forEach((button) => {
	button.addEventListener('click', () => setMapTarget(button.dataset.mapTarget));
});

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

async function addUpdate(title, message) {
	const { data, error } = await supabaseClient
		.from('notifications')
		.insert({ user_id: currentUser.id, title, message })
		.select('*')
		.single();
	if (error) throw error;
	updates.unshift(mapNotificationRow(data));
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

const themeToggle = document.querySelector('#theme-toggle');
applyTheme(readStored('localTransportTheme', 'dark'));
themeToggle.addEventListener('click', () => {
	const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
	writeStored('localTransportTheme', nextTheme);
	applyTheme(nextTheme);
});

document.querySelector('#login-form').addEventListener('submit', (event) => {
	event.preventDefault();
	void (async () => {
		const formData = new FormData(event.currentTarget);
		const { data, error } = await supabaseClient.auth.signInWithPassword({
			email: formData.get('identity').trim(),
			password: formData.get('password'),
		});
		if (error) {
			showMessage(error.message);
			return;
		}
		currentUser = data.user;
		try {
			await loadUserData(currentUser);
			showScreen('dashboard');
		} catch (loadError) {
			showMessage(`Signed in, but couldn't load your data: ${loadError.message}`);
		}
	})();
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
	void (async () => {
		const formData = new FormData(accountForm);
		const emailRedirectTo = window.location.protocol === 'file:'
			? undefined
			: `${window.location.origin}${window.location.pathname}`;
		const { data, error } = await supabaseClient.auth.signUp({
			email: formData.get('email').trim(),
			password: formData.get('password'),
			options: {
				...(emailRedirectTo ? { emailRedirectTo } : {}),
				data: {
					full_name: formData.get('fullName').trim(),
					mobile: formData.get('mobile').trim(),
					municipality: formData.get('municipality').trim(),
					barangay: formData.get('barangay').trim(),
				},
			},
		});
		if (error) {
			showMessage(error.message);
			return;
		}
		if (!data.session || !data.user) {
			showScreen('login');
			showMessage('Account created. Check your email to confirm it, then log in.');
			return;
		}
		currentUser = data.user;
		try {
			await loadUserData(currentUser);
			showScreen('dashboard');
		} catch (loadError) {
			showMessage(`Account created, but couldn't load your profile: ${loadError.message}`);
		}
	})();
});

const bookForm = document.querySelector('#book-form');
const dateInput = document.querySelector('#pickup-date');
const today = new Date();
dateInput.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

bookForm.addEventListener('submit', (event) => {
	event.preventDefault();
	void (async () => {
		const formData = new FormData(bookForm);
		const tripInput = {
			passenger_id: currentUser.id,
			pickup: formData.get('pickup').trim(),
			destination: formData.get('destination').trim(),
			pickup_at: new Date(`${formData.get('date')}T${formData.get('time')}`).toISOString(),
			ride_type: normalizeRideType(formData.get('rideType')),
			notes: formData.get('notes').trim(),
		};
		const { data, error } = await supabaseClient.from('trips').insert(tripInput).select('*').single();
		if (error) {
			showMessage(error.message);
			return;
		}
		const trip = mapTripRow(data);
		trips.unshift(trip);
		let successMessage = 'Ride request added to Upcoming rides.';
		try {
			await addUpdate('Ride request created', `Your trip from ${trip.pickup} to ${trip.destination} is in Upcoming rides.`);
		} catch {
			successMessage = 'Ride saved, but its notification could not be created.';
		}
		bookForm.reset();
		Object.keys(mapPoints).forEach((point) => {
			mapPoints[point] = null;
			mapMarkers[point]?.remove();
			mapMarkers[point] = null;
		});
		if (routeLine) routeLine.remove();
		routeLine = null;
		setMapTarget('pickup');
		renderDashboard();
		renderRides();
		showScreen('rides');
		showMessage(successMessage);
	})();
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
	void (async () => {
		const { error } = await supabaseClient.from('trips').update({ status: 'cancelled' }).eq('id', trip.id);
		if (error) {
			showMessage(error.message);
			return;
		}
		trip.status = 'Cancelled';
		let successMessage = 'Ride request cancelled.';
		try {
			await addUpdate('Ride request cancelled', `Your trip from ${trip.pickup} to ${trip.destination} was cancelled.`);
		} catch {
			successMessage = 'Ride cancelled, but its notification could not be created.';
		}
		renderDashboard();
		renderRides();
		showMessage(successMessage);
	})();
});

document.querySelector('#mark-updates-read').addEventListener('click', () => {
	void (async () => {
		const { error } = await supabaseClient
			.from('notifications')
			.update({ is_read: true })
			.eq('user_id', currentUser.id)
			.eq('is_read', false);
		if (error) {
			showMessage(error.message);
			return;
		}
		updates = updates.map((update) => ({ ...update, read: true }));
		renderUpdates();
		showMessage('Updates marked as read.');
	})();
});

document.querySelector('#profile-form').addEventListener('submit', (event) => {
	event.preventDefault();
	void (async () => {
		const formData = new FormData(event.currentTarget);
		const { data, error } = await supabaseClient
			.from('profiles')
			.update({
				full_name: formData.get('fullName').trim(),
				mobile: formData.get('mobile').trim(),
				municipality: formData.get('municipality').trim(),
				barangay: formData.get('barangay').trim(),
			})
			.eq('id', currentUser.id)
			.select('*')
			.single();
		if (error) {
			showMessage(error.message);
			return;
		}
		profile = mapProfileRow(data);
		renderProfile();
		showMessage('Profile saved.');
	})();
});

document.querySelector('#logout-button').addEventListener('click', () => {
	void supabaseClient.auth.signOut().then(({ error }) => {
		if (error) {
			showMessage(error.message);
			return;
		}
		clearUserData();
		document.querySelector('#login-form').reset();
	});
});

supabaseClient.auth.onAuthStateChange((event) => {
	if (event === 'SIGNED_OUT') clearUserData();
});

async function initializeAuth() {
	showScreen('login');
	const { data, error } = await supabaseClient.auth.getSession();
	if (error) {
		showMessage(error.message);
		return;
	}
	if (!data.session) return;
	currentUser = data.session.user;
	try {
		await loadUserData(currentUser);
		showScreen('dashboard');
	} catch (loadError) {
		showMessage(`Couldn't load your account: ${loadError.message}`);
	}
}

void initializeAuth();
