'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const app = document.getElementById('app');
const crumbsEl = document.getElementById('breadcrumbs');
const toastEl = document.getElementById('toast');

/** Create an element. attrs: props/attributes; "on*" keys become listeners. */
function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs || {})) {
		if (value == null || value === false) continue;
		if (key.startsWith('on') && typeof value === 'function') {
			node.addEventListener(key.slice(2), value);
		} else if (key === 'class') {
			node.className = value;
		} else if (key in node && typeof value !== 'string') {
			node[key] = value;
		} else {
			node.setAttribute(key, value === true ? '' : value);
		}
	}
	for (const child of children.flat()) {
		if (child == null || child === false) continue;
		node.append(child instanceof Node ? child : String(child));
	}
	return node;
}

/** A link handled by the client-side router. */
function link(href, attrs, ...children) {
	return el('a', { href, 'data-link': true, ...attrs }, ...children);
}

const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
	const node = document.createElementNS(svgNS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
	for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
	return node;
}

function trashIcon() {
	return svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'aria-hidden': 'true' },
		svg('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
			d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' }));
}

async function api(method, path, body) {
	const res = await fetch(path, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	let data = null;
	try { data = await res.json(); } catch { /* non-JSON response */ }
	if (!res.ok) {
		const err = new Error(data?.error || `Request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return data;
}

let toastTimer;
function toast(message, isError = false) {
	toastEl.textContent = message;
	toastEl.classList.toggle('error', isError);
	toastEl.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function setCrumbs(items) {
	crumbsEl.replaceChildren();
	items.forEach((item, i) => {
		if (i > 0) crumbsEl.append(el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'));
		const last = i === items.length - 1;
		crumbsEl.append(last
			? el('span', { class: 'current', 'aria-current': 'page' }, item.label)
			: link(item.href, {}, item.label));
	});
}

const HOME = { label: 'Home', href: '/' };
const CLASSES = { label: 'Classes', href: '/class' };

function formatDate(unixSeconds) {
	return new Date(unixSeconds * 1000).toLocaleString(undefined, {
		year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
	});
}

function signed(n) {
	return (n > 0 ? '+' : '') + n;
}

function storageGet(key) {
	try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
	try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Views. Each one renders into `app` and may return a cleanup function.
// ---------------------------------------------------------------------------

function homeView() {
	document.title = 'ClassPoints';
	setCrumbs([HOME]);
	app.replaceChildren(
		el('section', { class: 'hero' },
			el('h1', {}, 'Student Assessment System'),
			el('p', { class: 'subtitle' }, 'Give students points for the good things they do.'),
			el('div', { class: 'row' },
				link('/class', { class: 'btn btn-lg' }, 'View classes'),
				link('/addClass', { class: 'btn btn-lg btn-primary' }, 'Create new class'),
			),
		),
	);
}

async function classesView() {
	document.title = 'Classes · ClassPoints';
	setCrumbs([HOME, CLASSES]);
	const classes = await api('GET', '/api/classes');

	const head = el('div', { class: 'page-head' },
		el('h1', {}, 'Classes'),
		link('/addClass', { class: 'btn btn-primary' }, 'Create new class'));

	const body = classes.length
		? el('div', { class: 'grid' }, classes.map(c =>
			link(`/class/${c.id}`, { class: 'card' },
				el('h3', {}, c.name),
				el('p', {}, `${c.student_count} student${c.student_count === 1 ? '' : 's'}`))))
		: el('div', { class: 'empty' },
			el('p', {}, 'No classes found'),
			link('/addClass', { class: 'btn btn-primary' }, 'Create your first class'));

	app.replaceChildren(head, body);
}

function addClassView() {
	document.title = 'Create class · ClassPoints';
	setCrumbs([HOME, CLASSES, { label: 'Add class' }]);

	const students = [];
	let submitting = false;

	const errorBox = el('div', { class: 'alert alert-error', hidden: true });
	const classInput = el('input', { class: 'input', id: 'className', placeholder: 'Enter class name (e.g. 10D)', autocomplete: 'off' });
	const studentInput = el('input', { class: 'input', id: 'studentName', placeholder: 'Enter student name', autocomplete: 'off' });
	const addBtn = el('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Add');
	const csvInput = el('input', { type: 'file', id: 'csvFile', accept: '.csv,text/csv', class: 'input' });
	const listLabel = el('div', { class: 'label' });
	const list = el('ul', { class: 'student-list' });
	const listWrap = el('div', { class: 'field', hidden: true }, listLabel, list);
	const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Create class');

	function showError(msg) {
		errorBox.textContent = msg || '';
		errorBox.hidden = !msg;
	}

	function refresh() {
		addBtn.disabled = !studentInput.value.trim();
		submitBtn.disabled = submitting || !classInput.value.trim() || students.length === 0;
		submitBtn.textContent = submitting ? 'Creating…' : 'Create class';
		listWrap.hidden = students.length === 0;
		listLabel.textContent = `Students (${students.length})`;
		list.replaceChildren(...students.map((name, i) =>
			el('li', {},
				el('span', {}, name),
				el('button', {
					type: 'button', class: 'btn btn-icon', title: `Remove ${name}`, 'aria-label': `Remove ${name}`,
					onclick: () => { students.splice(i, 1); refresh(); },
				}, trashIcon()))));
	}

	function addStudent() {
		const name = studentInput.value.trim();
		if (!name) return;
		if (students.includes(name)) {
			showError('Student already added');
			studentInput.classList.add('invalid');
			return;
		}
		students.push(name);
		studentInput.value = '';
		showError('');
		refresh();
		studentInput.focus();
	}

	studentInput.addEventListener('keydown', e => {
		if (e.key === 'Enter') {
			e.preventDefault();
			addStudent();
		}
	});
	studentInput.addEventListener('input', () => {
		studentInput.classList.remove('invalid');
		if (errorBox.textContent === 'Student already added') showError('');
		refresh();
	});
	classInput.addEventListener('input', refresh);
	addBtn.addEventListener('click', addStudent);

	csvInput.addEventListener('change', async () => {
		const file = csvInput.files[0];
		if (!file) return;
		try {
			const added = parseStudentCsv(await file.text())
				.filter(name => !students.includes(name));
			students.push(...added);
			showError('');
			toast(`Imported ${added.length} student${added.length === 1 ? '' : 's'}`);
			refresh();
		} catch (err) {
			showError(err.message);
		} finally {
			csvInput.value = '';
		}
	});

	const form = el('form', { class: 'card', novalidate: true },
		el('div', { class: 'field' },
			el('label', { class: 'label', for: 'className' }, 'Class name'),
			classInput),
		el('div', { class: 'divider' }, 'Students'),
		el('div', { class: 'field' },
			el('label', { class: 'label', for: 'studentName' }, 'Add student'),
			el('div', { class: 'row' }, studentInput, addBtn)),
		el('div', { class: 'field' },
			el('label', { class: 'label', for: 'csvFile' },
				'Or import from CSV',
				el('span', { class: 'hint' }, 'Expected columns: Fornavn, Etternavn')),
			csvInput),
		listWrap,
		el('div', { class: 'form-actions' },
			link('/', { class: 'btn btn-ghost' }, 'Cancel'),
			submitBtn));

	form.addEventListener('submit', async e => {
		e.preventDefault();
		if (!classInput.value.trim()) return showError('Class name is required');
		if (students.length === 0) return showError('At least one student is required');
		showError('');
		submitting = true;
		refresh();
		try {
			const { id } = await api('POST', '/api/classes', { name: classInput.value.trim(), students });
			navigate(`/class/${id}`);
		} catch (err) {
			showError(err.message);
			submitting = false;
			refresh();
		}
	});

	app.replaceChildren(el('h1', { style: 'margin-bottom:24px' }, 'Create new class'), errorBox, form);
	app.style.maxWidth = '820px';
	classInput.focus();
	return () => { app.style.maxWidth = ''; };
}

/** Parse a CSV with "Fornavn" and "Etternavn" columns into full names. */
function parseStudentCsv(text) {
	text = text.replace(/^﻿/, '');
	const lines = text.split(/\r?\n/).filter(l => l.trim());
	if (lines.length < 2) {
		throw new Error('CSV file must contain at least a header row and one data row');
	}
	const sep = lines[0].includes(';') ? ';' : ',';
	const split = line => line.split(sep).map(c => c.replace(/"/g, '').trim());
	const headers = split(lines[0]).map(h => h.toLowerCase());
	const first = headers.indexOf('fornavn');
	const last = headers.indexOf('etternavn');
	if (first === -1 || last === -1) {
		throw new Error('CSV file must contain "Fornavn" and "Etternavn" columns');
	}
	const names = [];
	for (const line of lines.slice(1)) {
		const row = split(line);
		if (row[first] && row[last]) {
			const name = `${row[first]} ${row[last]}`;
			if (!names.includes(name)) names.push(name);
		}
	}
	return names;
}

async function classView({ id }) {
	const data = await api('GET', `/api/classes/${id}`);
	document.title = `${data.class.name} · ClassPoints`;
	setCrumbs([HOME, CLASSES, { label: data.class.name }]);

	const filter = el('input', { class: 'input', type: 'search', placeholder: 'Filter students by name…', 'aria-label': 'Filter students' });
	const grid = el('div');

	function render() {
		const q = filter.value.trim().toLowerCase();
		const shown = data.students.filter(s => s.name.toLowerCase().includes(q));
		grid.replaceChildren(shown.length
			? el('div', { class: 'grid' }, shown.map(s =>
				link(`/student/${s.id}`, { class: 'card' },
					el('h3', {}, s.name),
					el('p', {}, 'Click to view/add points'))))
			: el('div', { class: 'empty' }, el('p', {}, 'No students found in this class')));
	}
	filter.addEventListener('input', render);
	render();

	app.replaceChildren(
		el('h1', {}, data.class.name),
		el('p', { class: 'subtitle' }, `Students in this class (${data.students.length})`),
		el('div', { class: 'row', style: 'margin-bottom:24px' },
			filter,
			link(`/class/overview?classId=${data.class.id}`, { class: 'btn btn-primary' }, 'View points overview')),
		grid);
	filter.focus();
}

async function overviewView(params, query) {
	const classId = query.get('classId');
	if (!classId || !/^\d+$/.test(classId)) {
		throw Object.assign(new Error('A valid class ID is required'), { status: 400 });
	}
	const data = await api('GET', `/api/classes/${classId}/overview`);
	document.title = `Overview · ${data.class.name} · ClassPoints`;
	setCrumbs([HOME, CLASSES, { label: data.class.name, href: `/class/${classId}` }, { label: 'Overview' }]);

	const head = [
		el('h1', {}, 'Class points overview'),
		el('p', { class: 'subtitle' }, data.class.name),
	];
	if (!data.students.length) {
		app.replaceChildren(...head, el('div', { class: 'empty' }, el('p', {}, 'No students found in this class')));
		return;
	}

	const chartBox = el('div', { class: 'chart' });
	const tbody = el('tbody');
	let sortKey = 'name';
	let sortDir = 1;

	function renderTable() {
		const rows = [...data.students].sort((a, b) =>
			sortKey === 'name'
				? sortDir * a.name.localeCompare(b.name)
				: sortDir * (a.total - b.total) || a.name.localeCompare(b.name));
		tbody.replaceChildren(...rows.map(s =>
			el('tr', {},
				el('td', {}, link(`/student/${s.id}`, {}, s.name)),
				el('td', { class: 'num ' + (s.total > 0 ? 'pos' : s.total < 0 ? 'neg' : '') }, s.total))));
		for (const th of table.querySelectorAll('th')) {
			const active = th.dataset.key === sortKey;
			th.setAttribute('aria-sort', active ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
			th.querySelector('span').textContent = active ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
		}
	}
	function header(key, label, cls) {
		return el('th', {
			'data-key': key, class: cls, scope: 'col',
			onclick: () => {
				sortDir = sortKey === key ? -sortDir : (key === 'total' ? -1 : 1);
				sortKey = key;
				renderTable();
			},
		}, label, el('span'));
	}
	const table = el('table', {},
		el('thead', {}, el('tr', {}, header('name', 'Student name'), header('total', 'Total points', 'num'))),
		tbody);
	renderTable();

	app.replaceChildren(...head,
		el('div', { class: 'card chart-card' }, el('h2', {}, 'Student points'), chartBox),
		el('h2', {}, 'Detailed breakdown'),
		el('div', { class: 'table-wrap' }, table));

	const draw = () => chartBox.replaceChildren(barChart(data.students, chartBox.clientWidth));
	draw();
	let resizeTimer;
	const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 100); };
	window.addEventListener('resize', onResize);
	return () => window.removeEventListener('resize', onResize);
}

/** Draw a simple SVG bar chart of student totals (supports negative values). */
function barChart(students, availableWidth) {
	const height = 420;
	const pad = { top: 24, right: 12, bottom: 0, left: 44 };
	const slot = 56;
	const width = Math.max(availableWidth || 600, pad.left + pad.right + students.length * 40);
	const step = (width - pad.left - pad.right) / students.length;
	const rotate = step < 90;
	pad.bottom = (rotate ? 110 : 40) + (Math.min(...students.map(s => s.total)) < 0 ? 16 : 0);

	const values = students.map(s => s.total);
	let max = Math.max(0, ...values);
	let min = Math.min(0, ...values);
	if (max === min) max = 1;

	// Pick a "nice" tick step
	const range = max - min;
	const rough = range / 5;
	const mag = 10 ** Math.floor(Math.log10(rough));
	const tickStep = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= rough) || mag * 10);
	max = Math.ceil(max / tickStep) * tickStep;
	min = Math.floor(min / tickStep) * tickStep;

	const plotH = height - pad.top - pad.bottom;
	const y = v => pad.top + (max - v) / (max - min) * plotH;

	const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Bar chart of total points per student' });

	for (let v = min; v <= max; v += tickStep) {
		root.append(
			svg('line', { class: v === 0 ? 'axis' : 'grid-line', x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }),
			svg('text', { x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, v));
	}

	const barW = Math.min(slot, step * 0.7);
	students.forEach((s, i) => {
		const cx = pad.left + step * i + step / 2;
		const top = y(Math.max(0, s.total));
		const h = Math.max(Math.abs(y(s.total) - y(0)), s.total === 0 ? 0 : 1);
		// Leave room under the plot for the value label of a negative bar
		const labelY = height - pad.bottom + (min < 0 ? 32 : 16);
		const label = rotate
			? svg('text', { x: cx, y: labelY, 'text-anchor': 'end', transform: `rotate(-45 ${cx} ${labelY})` }, truncate(s.name, 16))
			: svg('text', { x: cx, y: labelY, 'text-anchor': 'middle' }, truncate(s.name, Math.floor(step / 7)));
		root.append(svg('g', { class: 'bar-group' },
			svg('title', {}, `${s.name}: ${s.total} point${Math.abs(s.total) === 1 ? '' : 's'}`),
			svg('rect', { class: 'bar' + (s.total < 0 ? ' neg' : ''), x: cx - barW / 2, y: top, width: barW, height: h, rx: 4 }),
			svg('text', { class: 'value', x: cx, y: s.total < 0 ? y(s.total) + 15 : top - 6, 'text-anchor': 'middle' }, s.total),
			label));
	});
	return root;
}

function truncate(text, max) {
	return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
}

async function studentView({ id }) {
	let data = await api('GET', `/api/students/${id}`);
	document.title = `${data.student.name} · ClassPoints`;
	setCrumbs([HOME, CLASSES, { label: data.class.name, href: `/class/${data.class.id}` }, { label: data.student.name }]);

	let count = 0;
	let saving = false;

	const countEl = el('div', { class: 'counter-value', 'aria-live': 'polite' }, '0');
	const commentInput = el('input', { class: 'input', id: 'comment', placeholder: 'Add a comment…', autocomplete: 'off' });
	const saveBtn = el('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: savePoints }, 'Save points');
	const message = el('div', { class: 'alert', hidden: true, style: 'margin-top:16px' });
	const historyToggle = el('input', { type: 'checkbox', checked: storageGet('showHistory') === '1' });
	const historyBox = el('div');

	function setCount(n) {
		count = n;
		countEl.textContent = signed(n);
	}
	function showMessage(text, ok) {
		message.textContent = text;
		message.className = 'alert ' + (ok ? 'alert-success' : 'alert-error');
		message.hidden = false;
	}

	async function reload() {
		data = await api('GET', `/api/students/${id}`);
		renderHistory();
	}

	async function savePoints() {
		if (saving) return;
		if (count === 0) return showMessage('Please add or remove points first', false);
		saving = true;
		saveBtn.disabled = true;
		saveBtn.textContent = 'Saving…';
		message.hidden = true;
		try {
			await api('POST', '/api/points', { studentId: data.student.id, pointsValue: count, content: commentInput.value });
			toast(`Saved ${signed(count)} point${Math.abs(count) === 1 ? '' : 's'} for ${data.student.name}`);
			setCount(0);
			commentInput.value = '';
			await reload();
		} catch (err) {
			showMessage('Error saving points: ' + err.message, false);
		} finally {
			saving = false;
			saveBtn.disabled = false;
			saveBtn.textContent = 'Save points';
		}
	}

	async function deletePoint(pointId) {
		if (!confirm('Are you sure you want to delete this point entry?')) return;
		try {
			await api('DELETE', `/api/points/${pointId}`);
			toast('Point entry deleted');
			await reload();
		} catch (err) {
			showMessage('Error deleting point: ' + err.message, false);
		}
	}

	function renderHistory() {
		if (!historyToggle.checked) return historyBox.replaceChildren();
		const total = data.points.reduce((sum, p) => sum + p.points, 0);
		const n = data.points.length;
		historyBox.replaceChildren(
			el('div', { class: 'card stat' },
				el('div', { class: 'stat-title' }, 'Total points'),
				el('div', { class: 'stat-value' }, total),
				el('div', { class: 'stat-desc' }, `${n} submission${n === 1 ? '' : 's'}`)),
			el('h2', {}, 'Point history'),
			n === 0
				? el('p', { class: 'muted' }, 'No points recorded yet.')
				: el('div', { class: 'history' }, data.points.map(p =>
					el('div', { class: 'card history-item' },
						el('div', {},
							el('div', { class: 'amount ' + (p.points > 0 ? 'pos' : 'neg') },
								`${signed(p.points)} point${Math.abs(p.points) === 1 ? '' : 's'}`),
							p.content && el('p', { class: 'comment' }, p.content)),
						el('div', { class: 'meta' },
							el('time', { datetime: new Date(p.created_at * 1000).toISOString() }, formatDate(p.created_at)),
							el('button', {
								type: 'button', class: 'btn btn-icon', title: 'Delete this point entry',
								'aria-label': 'Delete this point entry', onclick: () => deletePoint(p.id),
							}, trashIcon()))))));
	}
	historyToggle.addEventListener('change', () => {
		storageSet('showHistory', historyToggle.checked ? '1' : '0');
		renderHistory();
	});

	app.replaceChildren(
		link(`/class/${data.class.id}`, { class: 'btn btn-outline btn-sm', style: 'margin-bottom:16px' }, `← Back to ${data.class.name}`),
		el('h1', {}, data.student.name),
		el('p', { class: 'subtitle' }, `Class: ${data.class.name}`),
		el('div', { class: 'card point-maker' },
			el('h2', {}, 'Points'),
			el('div', { class: 'counter' },
				el('button', { type: 'button', class: 'counter-btn minus', 'aria-label': 'Decrease points', onclick: () => setCount(count - 1) }, '−'),
				countEl,
				el('button', { type: 'button', class: 'counter-btn plus', 'aria-label': 'Increase points', onclick: () => setCount(count + 1) }, '+')),
			el('label', { class: 'label', for: 'comment' }, 'Comment'),
			commentInput,
			el('div', { style: 'margin-top:20px' }, saveBtn),
			el('p', { class: 'shortcuts' },
				'Shortcuts: ', el('kbd', {}, '+'), ' / ', el('kbd', {}, '−'), ' change points, ',
				el('kbd', {}, 'Enter'), ' saves.')),
		message,
		el('label', { class: 'toggle' }, historyToggle, 'Show point history'),
		historyBox);
	renderHistory();

	// Keyboard shortcuts: +/= and - adjust points (outside text fields), Enter saves.
	function onKey(e) {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const t = e.target;
		const inField = t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA';
		if ((e.key === '+' || e.key === '=') && !inField) {
			e.preventDefault();
			setCount(count + 1);
		} else if (e.key === '-' && !inField) {
			e.preventDefault();
			setCount(count - 1);
		} else if (e.key === 'Enter' && t.tagName !== 'A' && !t.classList.contains('btn-icon')) {
			// Like the original app, Enter saves even when a +/- button has focus
			e.preventDefault();
			savePoints();
		}
	}
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
}

function notFoundView(message = 'Page not found') {
	document.title = 'Not found · ClassPoints';
	setCrumbs([HOME, { label: 'Not found' }]);
	app.replaceChildren(el('div', { class: 'empty' },
		el('h1', {}, 'Oops'),
		el('p', {}, message),
		link('/', { class: 'btn btn-primary' }, 'Go home')));
}

// ---------------------------------------------------------------------------
// Router (History API, so URLs look like /class/3 and /student/7)
// ---------------------------------------------------------------------------

const routes = [
	[/^\/$/, homeView],
	[/^\/class\/?$/, classesView],
	[/^\/addClass\/?$/, addClassView],
	[/^\/class\/overview\/?$/, overviewView],
	[/^\/class\/(?<id>\d+)\/?$/, classView],
	[/^\/student\/(?<id>\d+)\/?$/, studentView],
];

let cleanup = null;
let renderToken = 0;

async function render() {
	const token = ++renderToken;
	if (cleanup) { cleanup(); cleanup = null; }
	const { pathname, search } = location;
	const query = new URLSearchParams(search);
	for (const [pattern, view] of routes) {
		const match = pathname.match(pattern);
		if (!match) continue;
		try {
			const result = await view(match.groups || {}, query);
			if (token === renderToken) cleanup = typeof result === 'function' ? result : null;
			else if (typeof result === 'function') result();
		} catch (err) {
			if (token !== renderToken) return;
			if (err.status === 404 || err.status === 400) notFoundView(err.message);
			else {
				console.error(err);
				app.replaceChildren(el('div', { class: 'alert alert-error' }, 'Something went wrong: ' + err.message));
			}
		}
		return;
	}
	notFoundView();
}

function navigate(href) {
	history.pushState(null, '', href);
	window.scrollTo(0, 0);
	render();
}

document.addEventListener('click', e => {
	const a = e.target.closest('a[data-link]');
	if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
	e.preventDefault();
	navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

render();
