// ─────────────────────────────────────────────────────────────────────
// CONFIG — this is v2's OWN backend (new Sheet + new Apps Script
// deployment), separate from the live app, so it does not affect current
// users. Paste the new Web App /exec URL here after deploying it —
// see the Apps Script project bound to the new Google Sheet.
// ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwL0yLduCoItYz-g5XF8I0NZUmIsSfio5O2x3ivumSS4KXFpOW0QFBlH8-tpWiXHFNq/exec';

const STORAGE_KEY = 'visionchildandyouthcarecentre@gmail.com';
const DEV_TOKEN_KEY = 'cashup_dev_token'; // developer sign-in session (6 hours from last use)

const SESSION_KEY = 'cashup_session';   // signed-in device (sign-in codes), 30 days
const VIEW_AS_KEY = 'cashup_view_as';   // developer "view as" (this browser tab only)

function getSessionToken() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
}
function setSessionToken(token) {
  try { if (token) localStorage.setItem(SESSION_KEY, token); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}
function getViewAs() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_AS_KEY) || 'null'); } catch (e) { return null; }
}
function setViewAs(v) {
  try { if (v) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(v)); else sessionStorage.removeItem(VIEW_AS_KEY); } catch (e) { /* ignore */ }
}
function authToken() { return getDevToken() || getSessionToken(); }

function getDevToken() {
  try { return localStorage.getItem(DEV_TOKEN_KEY) || ''; } catch (e) { return ''; }
}
function setDevToken(token) {
  try { if (token) localStorage.setItem(DEV_TOKEN_KEY, token); else localStorage.removeItem(DEV_TOKEN_KEY); } catch (e) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────
// API HELPERS
// Notes on CORS: GET requests and POST requests with a text/plain body
// (no custom headers) avoid the CORS preflight that Apps Script can't
// answer, and Apps Script's response comes back readable — no need for
// the mode:'no-cors' blind-send workaround here.
// ─────────────────────────────────────────────────────────────────────

async function apiGet(action, params) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach((k) => url.searchParams.set(k, params[k]));
  const token = authToken();
  if (token) url.searchParams.set('token', token);
  const va = getViewAs();
  if (va) url.searchParams.set('viewAs', va.email);
  return checkDevSession(await fetchWithRetry(() => fetch(url.toString())));
}

async function apiPost(action, data) {
  const payload = Object.assign({ action: action }, data);
  const token = authToken();
  if (token) payload.token = token;
  const va = getViewAs();
  if (va) payload.viewAs = va.email;
  const body = JSON.stringify(payload);
  return checkDevSession(await fetchWithRetry(() => fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body
  })));
}

// A developer's sign-in lasts 6 hours from last use. If it runs out mid-way,
// the server answers "Not authorized" — send them back to the password screen.
// A signed-in device can also be signed out elsewhere or expire (30 days):
// then go back to the sign-in code screen.
let lastSessionCheck = 0;
function checkDevSession(result) {
  if (!result || result.success !== false || result.viewOnly) return result;
  const denied = /Not authorized/.test(result.error || '') || result.viewAsEnded;
  if (!denied) return result;
  if (getViewAs()) {
    setViewAs(null);
    setDevToken('');
    setTimeout(() => location.reload(), 0);
  } else if (currentUser && currentUser.role === 'Developer') {
    setDevToken('');
    setTimeout(() => showDevLogin(currentUser.email, 'Your developer sign-in has expired. Please sign in again.'), 0);
  } else if (currentUser && currentUser.signInCodes && Date.now() - lastSessionCheck > 30000) {
    lastSessionCheck = Date.now();
    setSessionToken('');
    const email = currentUser.email;
    setTimeout(() => routeForEmail(email), 0);
  }
  return result;
}

// Apps Script occasionally serves a broken response (cold start, or an
// infrastructure hiccup on Google's side) instead of real JSON — the actual
// server-side action may still have completed. This wrapper retries once
// before giving up, and always resolves to an object instead of throwing,
// so nothing in the app can hang on an unhandled rejection.
async function fetchWithRetry(doFetch, attempts) {
  attempts = attempts || 2;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch();
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        // fall through to retry
      }
    } catch (fetchErr) {
      // fall through to retry
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  return { success: false, networkError: true, error: 'Could not reach the server. Please check your connection and try again.' };
}

// ─────────────────────────────────────────────────────────────────────
// VIEW ROUTING
// ─────────────────────────────────────────────────────────────────────

const views = ['auth', 'signincode', 'devlogin', 'pending', 'rejected', 'inactive', 'manager', 'shopexp', 'submitted', 'admin',
  'backoffice', 'deliveries', 'hoexp', 'till', 'assets', 'downloads', 'developer', 'nopages', 'loading'];
const NAVLESS_VIEWS = ['auth', 'signincode', 'devlogin', 'pending', 'rejected', 'inactive', 'nopages', 'loading'];
function showView(name) {
  views.forEach((v) => {
    document.getElementById('view-' + v).hidden = (v !== name);
  });
  const nav = document.getElementById('appNav');
  nav.hidden = NAVLESS_VIEWS.indexOf(name) !== -1 || nav.children.length < 2;
}

let currentUser = null; // { email, fullName, role, branch }

document.getElementById('switchUserBtn').addEventListener('click', () => {
  stopBell();
  finSetup = null;
  posCfg = null; posTab = 'sell'; posSale = { lines: [], method: 'Cash' };
  assetData = null; assetTab = 'overview';
  if (getDevToken()) { apiPost('devLogout', {}); setDevToken(''); }
  if (getSessionToken()) { apiPost('signOut', {}); setSessionToken(''); }
  localStorage.removeItem(STORAGE_KEY);
  currentUser = null;
  document.getElementById('appNav').innerHTML = '';
  document.body.classList.remove('wide-admin');
  document.getElementById('whoami').textContent = '';
  document.getElementById('switchUserBtn').hidden = true;
  document.getElementById('authEmail').value = '';
  document.getElementById('registerFields').hidden = true;
  showView('auth');
});

async function init() {
  showView('loading');
  const va = getViewAs();
  if (va && getDevToken()) { await routeForEmail(va.email); return; }
  if (va) setViewAs(null);
  const savedEmail = localStorage.getItem(STORAGE_KEY);
  if (!savedEmail) {
    await loadBranchesIntoSelect('regBranch');
    showView('auth');
    return;
  }
  await routeForEmail(savedEmail);
}

async function routeForEmail(email) {
  showView('loading');
  const result = await apiGet('checkUser', { email: email });
  const viewing = !!getViewAs();
  // No internet? A device that has used the till can still open it.
  if (!result.success && result.networkError && !viewing) {
    const off = posRead('pos_offline_user', null);
    if (off && normEmailClient(off.email) === normEmailClient(email) && off.features && off.features.pos) {
      currentUser = off;
      document.getElementById('whoami').textContent = off.fullName + ' (offline)';
      document.getElementById('switchUserBtn').hidden = false;
      buildNav();
      openPage('till');
      showPosError('No internet — the till still works. Sales are kept on this device and sent when you\'re back online. Reload the page then to use the rest of the app.');
      return;
    }
  }
  if (!result.success) {
    if (result.viewAsEnded) return; // handled by checkDevSession (reloads)
    showAuthError(result.error || 'Something went wrong.');
    showView('auth');
    return;
  }
  if (!result.found) {
    localStorage.removeItem(STORAGE_KEY);
    await loadBranchesIntoSelect('regBranch');
    document.getElementById('authEmail').value = email;
    document.getElementById('registerFields').hidden = false;
    showView('auth');
    return;
  }

  if (result.needsPassword) {
    localStorage.setItem(STORAGE_KEY, email);
    showDevLogin(result.email || email, '');
    return;
  }
  if (result.needsCode) {
    localStorage.setItem(STORAGE_KEY, email);
    showCodeView(result.email || email);
    return;
  }

  if (!viewing) localStorage.setItem(STORAGE_KEY, email);
  currentUser = result;
  currentUser.features = result.features || {};
  document.getElementById('whoami').textContent = result.fullName + ' (' + (ROLE_LABELS[result.role] || result.role || 'pending') + ')';
  document.getElementById('switchUserBtn').hidden = false;
  updateViewAsBanner();

  if (result.status === 'Approved' && ROLE_PAGES[result.role]) {
    buildNav();
    startBell();
    const pages = allowedPages();
    if (!pages.length) { showView('nopages'); return; }
    // Opened from an email link like …/CashUp/#job=DEL-00012?
    const linkedJob = takeLinkedJobRef();
    if (linkedJob && pages.indexOf('deliveries') !== -1) {
      openPage('deliveries');
      openJob(linkedJob);
      return;
    }
    openPage(pages.indexOf(ROLE_HOME[result.role]) !== -1 ? ROLE_HOME[result.role] : pages[0]);
    return;
  }

  if (result.status === 'Pending') {
    document.getElementById('pendingName').textContent = result.fullName;
    showView('pending');
  } else if (result.status === 'Rejected') {
    showView('rejected');
  } else if (result.status === 'Inactive') {
    showView('inactive');
  } else if (result.status === 'Approved' && result.role === 'Manager') {
    setupManagerView(result);
    showView('manager');
  } else if (result.status === 'Approved' && result.role === 'Admin') {
    initAdminTabs(result.email);
    showView('admin');
  } else if (result.status === 'Approved' && result.role === 'BackOffice') {
    await loadBackOfficeView(result);
    showView('backoffice');
  } else {
    showAuthError('Your account has an unrecognised status. Please contact an admin.');
    showView('auth');
  }
}

function showAuthError(msg) {
  document.getElementById('authError').textContent = msg;
}

// ─────────────────────────────────────────────────────────────────────
// ROLE TABS & FEATURE FLAGS
// Which tabs each role gets. Tabs tied to a Pro feature only appear when
// the Developer tab has that feature switched on (the server sends the
// on/off list with checkUser). A role with a single tab shows no tab bar,
// so the Standard bundle looks exactly as before.
// ─────────────────────────────────────────────────────────────────────

const PAGES = {
  cashup:      { label: 'Daily Cash-Up' },
  shopexp:     { label: 'Shop Expenses', feature: 'shopExpenses' },
  approvals:   { label: 'Approvals' },
  submissions: { label: 'Submissions' },
  dashboard:   { label: 'Dashboard' },
  backoffice:  { label: 'Submissions' },
  deliveries:  { label: 'Deliveries', feature: 'deliveries' },
  hoexp:       { label: 'Head Office Finance', feature: 'hoExpenses' },
  till:        { label: 'Till', feature: 'pos' },
  assets:      { label: 'Assets', feature: 'assets' },
  downloads:   { label: 'Downloads', feature: 'downloads' },
  developer:   { label: 'Developer' }
};
const ROLE_PAGES = {
  Manager:    ['till', 'cashup', 'shopexp', 'deliveries', 'assets'],
  BackOffice: ['backoffice', 'deliveries', 'hoexp', 'till', 'assets', 'downloads'],
  Admin:      ['approvals', 'submissions', 'dashboard', 'deliveries', 'hoexp', 'till', 'assets', 'downloads'],
  Developer:  ['cashup', 'shopexp', 'approvals', 'submissions', 'dashboard', 'deliveries', 'hoexp', 'till', 'assets', 'downloads', 'developer'],
  Driver:     ['deliveries']
};
const ROLE_HOME = { Manager: 'cashup', BackOffice: 'backoffice', Admin: 'approvals', Developer: 'approvals', Driver: 'deliveries' };
let currentPage = null;

function featureOn(key) {
  return !!(currentUser && currentUser.features && currentUser.features[key]);
}

function allowedPages() {
  if (!currentUser) return [];
  return (ROLE_PAGES[currentUser.role] || []).filter((p) => !PAGES[p].feature || featureOn(PAGES[p].feature));
}

function buildNav() {
  const nav = document.getElementById('appNav');
  const pages = allowedPages();
  nav.innerHTML = pages.map((p) =>
    '<button type="button" class="app-nav-btn" data-page="' + p + '">' + escapeHtml(PAGES[p].label) +
    (p === 'shopexp' ? '<span class="nav-badge" id="shopExpBadge" hidden></span>' : '') + '</button>'
  ).join('');
  nav.querySelectorAll('.app-nav-btn').forEach((b) => b.addEventListener('click', () => openPage(b.dataset.page)));
  // With the global tab bar in charge, the Admin card's own tab row is hidden.
  document.querySelector('#view-admin .admin-tabs').hidden = true;
  updateShopExpBadge();
}

function openPage(page) {
  const pages = allowedPages();
  if (pages.indexOf(page) === -1) page = pages[0];
  currentPage = page;
  document.querySelectorAll('#appNav .app-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const activeBtn = document.querySelector('#appNav .app-nav-btn.active');
  if (activeBtn && activeBtn.scrollIntoView) activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (page !== 'approvals' && page !== 'dashboard') document.body.classList.toggle('wide-admin', page === 'assets' || page === 'till');

  switch (page) {
    case 'cashup':
      setupManagerView(currentUser);
      showView('manager');
      break;
    case 'shopexp':
      showView('shopexp');
      ensureFinanceSetup();
      break;
    case 'approvals':
    case 'submissions':
    case 'dashboard':
      showView('admin');
      switchAdminTab(page, currentUser.email);
      break;
    case 'backoffice':
      showView('backoffice');
      loadBackOfficeView(currentUser);
      break;
    case 'deliveries':
      showView('deliveries');
      loadJobs();
      break;
    case 'hoexp':
      showView('hoexp');
      loadFinancePage();
      break;
    case 'till':
      showView('till');
      loadTillPage();
      break;
    case 'assets':
      showView('assets');
      loadAssetsPage();
      break;
    case 'downloads':
      showView('downloads');
      loadDownloadsPage();
      break;
    case 'developer':
      showView('developer');
      loadDeveloperTab();
      break;
  }
  window.scrollTo(0, 0);
}

// ─────────────────────────────────────────────────────────────────────
// SIGN-IN CODES — when switched on (Developer tab), a device proves the
// person owns the email with a 6-digit code; it stays signed in 30 days.
// ─────────────────────────────────────────────────────────────────────

let codeEmail = '';

function showCodeView(email) {
  codeEmail = email;
  currentUser = null;
  stopBell();
  document.getElementById('appNav').innerHTML = '';
  document.body.classList.remove('wide-admin');
  document.getElementById('whoami').textContent = '';
  document.getElementById('switchUserBtn').hidden = true;
  document.getElementById('signInCode').value = '';
  document.getElementById('signInCodeError').textContent = '';
  showView('signincode');
  let sentAt = 0;
  try { sentAt = Number(sessionStorage.getItem('cashup_code_sent:' + email) || 0); } catch (e) { /* ignore */ }
  if (Date.now() - sentAt < 9 * 60 * 1000) {
    document.getElementById('codeSentText').textContent = 'Enter the 6-digit code we emailed to ' + email + '.';
  } else {
    sendSignInCode();
  }
  setTimeout(() => document.getElementById('signInCode').focus(), 50);
}

async function sendSignInCode() {
  const text = document.getElementById('codeSentText');
  const err = document.getElementById('signInCodeError');
  err.textContent = '';
  text.textContent = 'Sending a sign-in code to ' + codeEmail + '…';
  const res = await apiPost('requestSignInCode', { email: codeEmail });
  if (!res.success) {
    text.textContent = 'We couldn\'t send a code to ' + codeEmail + '.';
    err.textContent = res.error === 'Unknown action' ? 'Sign-in codes need the updated Apps Script. Ask a developer.' : (res.error || 'Please try again.');
    return;
  }
  try { sessionStorage.setItem('cashup_code_sent:' + codeEmail, String(Date.now())); } catch (e) { /* ignore */ }
  text.textContent = 'We\'ve emailed a 6-digit code to ' + (res.sentTo || codeEmail) + '. It can take a minute to arrive — check spam too.';
}

async function verifySignInCodeClick() {
  const btn = document.getElementById('signInCodeBtn');
  const err = document.getElementById('signInCodeError');
  const code = document.getElementById('signInCode').value.replace(/\D/g, '');
  err.textContent = '';
  if (code.length !== 6) { err.textContent = 'Enter the 6 digits from the email.'; return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  const res = await apiPost('verifySignInCode', { email: codeEmail, code: code, device: navigator.userAgent });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (!res.success) { err.textContent = res.error || 'Could not sign in.'; return; }
  setSessionToken(res.token);
  try { sessionStorage.removeItem('cashup_code_sent:' + codeEmail); } catch (e) { /* ignore */ }
  routeForEmail(codeEmail);
}

document.getElementById('signInCodeBtn').addEventListener('click', verifySignInCodeClick);
document.getElementById('signInCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') verifySignInCodeClick(); });
document.getElementById('signInCode').addEventListener('input', (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (v !== e.target.value) e.target.value = v;
  if (v.length === 6) verifySignInCodeClick();
});
document.getElementById('signInResend').addEventListener('click', sendSignInCode);
document.getElementById('signInSwitch').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  document.getElementById('authEmail').value = '';
  document.getElementById('registerFields').hidden = true;
  showView('auth');
});

// ─────────────────────────────────────────────────────────────────────
// VIEW AS (developers) — the whole app as another person sees it, read-only
// ─────────────────────────────────────────────────────────────────────

function updateViewAsBanner() {
  const va = getViewAs();
  document.getElementById('viewAsBanner').hidden = !va;
  document.body.classList.toggle('viewing-as', !!va);
  if (va) {
    document.getElementById('viewAsName').textContent = va.name + ' (' + (ROLE_LABELS[va.role] || va.role || 'no role') + ')';
    document.getElementById('switchUserBtn').hidden = true;
  }
}

document.getElementById('viewAsStop').addEventListener('click', () => {
  setViewAs(null);
  location.reload();
});

async function startViewAsClick() {
  const email = document.getElementById('viewAsUser').value;
  const msg = document.getElementById('viewAsMsg');
  if (!email) { msg.textContent = 'Choose a person first.'; msg.className = 'dev-msg is-error'; return; }
  const btn = document.getElementById('viewAsStart');
  btn.disabled = true;
  const res = await apiPost('startViewAs', { requesterEmail: currentUser.email, targetEmail: email });
  btn.disabled = false;
  if (!res.success) { msg.textContent = res.error === 'Unknown action' ? 'Redeploy the Apps Script first.' : res.error; msg.className = 'dev-msg is-error'; return; }
  setViewAs({ email: res.email, name: res.fullName, role: res.role, devEmail: currentUser.email });
  location.reload();
}

// ─────────────────────────────────────────────────────────────────────
// DEVELOPER SIGN-IN
// ─────────────────────────────────────────────────────────────────────

let devLoginEmailValue = '';

function showDevLogin(email, message) {
  devLoginEmailValue = email;
  currentUser = null;
  stopBell();
  document.getElementById('appNav').innerHTML = '';
  document.body.classList.remove('wide-admin');
  document.getElementById('devLoginEmail').textContent = email;
  document.getElementById('devPassword').value = '';
  document.getElementById('devLoginError').textContent = message || '';
  document.getElementById('whoami').textContent = '';
  document.getElementById('switchUserBtn').hidden = true;
  showView('devlogin');
  setTimeout(() => document.getElementById('devPassword').focus(), 50);
}

async function submitDevLogin() {
  const btn = document.getElementById('devLoginBtn');
  const errEl = document.getElementById('devLoginError');
  const password = document.getElementById('devPassword').value;
  errEl.textContent = '';
  if (!password) { errEl.textContent = 'Enter your password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  setDevToken('');
  const res = await apiPost('devLogin', { email: devLoginEmailValue, password: password, device: navigator.userAgent });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (!res.success) { errEl.textContent = res.error || 'Could not sign in.'; return; }
  setDevToken(res.token);
  document.getElementById('devPassword').value = '';
  await routeForEmail(devLoginEmailValue);
}

document.getElementById('devLoginBtn').addEventListener('click', submitDevLogin);
document.getElementById('devPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitDevLogin(); });
document.getElementById('devLoginSwitch').addEventListener('click', () => {
  setDevToken('');
  localStorage.removeItem(STORAGE_KEY);
  document.getElementById('authEmail').value = '';
  document.getElementById('registerFields').hidden = true;
  showView('auth');
});

// ─────────────────────────────────────────────────────────────────────
// AUTH / REGISTER VIEW
// ─────────────────────────────────────────────────────────────────────

document.getElementById('authContinueBtn').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  showAuthError('');
  if (!email) { showAuthError('Please enter your email.'); return; }
  await routeForEmail(email);
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const fullName = document.getElementById('regFullName').value.trim();
  const contact = document.getElementById('regContact').value.trim();
  const requestedBranch = document.getElementById('regBranch').value;
  showAuthError('');
  if (!email || !fullName || !contact) {
    showAuthError('Full name, contact number and email are all required.');
    return;
  }
  const btn = document.getElementById('registerBtn');
  btn.disabled = true; btn.textContent = 'Registering…';
  const result = await apiPost('register', { email, fullName, contact, requestedBranch });
  btn.disabled = false; btn.textContent = 'Register';
  if (!result.success) {
    showAuthError(result.error || 'Registration failed.');
    return;
  }
  localStorage.setItem(STORAGE_KEY, email);
  document.getElementById('pendingName').textContent = fullName;
  showView('pending');
});

async function loadBranchesIntoSelect(selectId) {
  const result = await apiGet('branches', {});
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  if (result.success) {
    result.branches.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      select.appendChild(opt);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// MANAGER CASH-UP FORM
// ─────────────────────────────────────────────────────────────────────

const DENOMS = [
  { id: 'r200', value: 200 }, { id: 'r100', value: 100 }, { id: 'r50', value: 50 },
  { id: 'r20', value: 20 }, { id: 'r10', value: 10 }, { id: 'r5', value: 5 },
  { id: 'r2', value: 2 }, { id: 'r1', value: 1 },
  { id: 'c50', value: 0.50 }, { id: 'c20', value: 0.20 }, { id: 'c10', value: 0.10 },
  { id: 'c5', value: 0.05 }, { id: 'c1', value: 0.01 }
];

function setupManagerView(user) {
  const branchInput = document.getElementById('mBranch');
  const isDev = user.role === 'Developer';
  document.getElementById('devCashupNote').hidden = !isDev;
  if (isDev) {
    // Developers test the form against a real branch of their choice.
    branchInput.readOnly = false;
    branchInput.setAttribute('list', 'devBranchList');
    branchInput.placeholder = 'Choose a branch to test with';
    if (branchInput.value === 'All branches') branchInput.value = '';
    ensureDevBranchList();
  } else {
    branchInput.value = user.branch;
  }
  if (!document.getElementById('mCasher').value) {
    document.getElementById('mCasher').value = user.fullName;
  }
  if (!document.getElementById('mDate').value) {
    document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  }
  document.getElementById('managerName').value = document.getElementById('managerName').value || '';
  recalcAll();
  if (typeof loadTillCashup === 'function') loadTillCashup();
}

async function ensureDevBranchList() {
  if (document.getElementById('devBranchList')) return;
  const list = document.createElement('datalist');
  list.id = 'devBranchList';
  document.body.appendChild(list);
  const result = await apiGet('branches', {});
  if (result.success) list.innerHTML = result.branches.map((b) => '<option value="' + escapeAttr(b) + '"></option>').join('');
}

function num(id) { return Number(document.getElementById(id).value) || 0; }
function rand(v) {
  const num = Number(v) || 0;
  const fixed = num.toFixed(2);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return 'R ' + parts.join('.');
}

function recalcAll() {
  const totalNettSales = num('grossSales') - num('overingPaidAmount') - num('cashRefundsAmount') - num('expensePaidAmount');
  document.getElementById('totalNettSales').textContent = rand(totalNettSales);

  let totalCashOnly = 0;
  DENOMS.forEach((d) => {
    const count = num(d.id);
    const sub = count * d.value;
    totalCashOnly += sub;
    document.getElementById('sub-' + d.id).textContent = rand(sub);
  });
  document.getElementById('totalCashOnly').textContent = rand(totalCashOnly);

  const totalCardsAndCash = totalCashOnly + num('totalCardSales');
  document.getElementById('totalCardsAndCash').textContent = rand(totalCardsAndCash);

  const shortOver = totalCardsAndCash - totalNettSales;
  const shortOverEl = document.getElementById('shortOverAmount');
  shortOverEl.textContent = rand(shortOver);
  shortOverEl.className = shortOver < 0 ? 'short-negative' : (shortOver > 0 ? 'short-positive' : '');

  recalcDonations();
}

function recalcDonations() {
  let total = 0;
  document.querySelectorAll('#donationsBody tr').forEach((row) => {
    total += Number(row.querySelector('.don-amount').value) || 0;
  });
  document.getElementById('totalDonations').textContent = rand(total);
}

['grossSales', 'overingPaidAmount', 'cashRefundsAmount', 'expensePaidAmount', 'totalCardSales',
  'r200', 'r100', 'r50', 'r20', 'r10', 'r5', 'r2', 'r1', 'c50', 'c20', 'c10', 'c5', 'c1'
].forEach((id) => {
  document.getElementById(id).addEventListener('input', recalcAll);
});

let donationRowCount = 0;
function addDonationRow() {
  donationRowCount++;
  const tr = document.createElement('tr');
  tr.innerHTML =
    '<td><input type="text" class="don-receipt"></td>' +
    '<td><input type="number" step="0.01" class="don-amount" value="0"></td>' +
    '<td><input type="date" class="don-date"></td>' +
    '<td><button type="button" class="row-remove">✕</button></td>';
  tr.querySelector('.don-amount').addEventListener('input', recalcDonations);
  tr.querySelector('.row-remove').addEventListener('click', () => { tr.remove(); recalcDonations(); });
  document.getElementById('donationsBody').appendChild(tr);
}
document.getElementById('addDonationBtn').addEventListener('click', addDonationRow);

// ─────────────────────────────────────────────────────────────────────
// DAILY SALES SHEET PHOTO
// A photo of the handwritten sales sheet, resized/compressed in the
// browser (so a phone photo doesn't blow past Apps Script's upload size),
// then sent as a base64 data URL and appended as a second page of the
// same cash-up PDF server-side — not a separate file or email.
// ─────────────────────────────────────────────────────────────────────

let salesSheetImageDataUrl = null;
const SALES_SHEET_MAX_DIMENSION = 1600;
const SALES_SHEET_JPEG_QUALITY = 0.72;

function resizeImageFileToDataUrl(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file doesn\'t look like a valid image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
          } else {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById('salesSheetInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  const errEl = document.getElementById('salesSheetError');
  errEl.textContent = '';
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    errEl.textContent = 'Please choose an image file.';
    e.target.value = '';
    return;
  }

  try {
    salesSheetImageDataUrl = await resizeImageFileToDataUrl(file, SALES_SHEET_MAX_DIMENSION, SALES_SHEET_JPEG_QUALITY);
    const preview = document.getElementById('salesSheetPreview');
    preview.src = salesSheetImageDataUrl;
    document.getElementById('salesSheetPreviewWrap').hidden = false;
  } catch (err) {
    errEl.textContent = err.message || 'Could not process that photo. Please try another.';
    salesSheetImageDataUrl = null;
  }
});

document.getElementById('salesSheetRemoveBtn').addEventListener('click', () => {
  salesSheetImageDataUrl = null;
  document.getElementById('salesSheetInput').value = '';
  document.getElementById('salesSheetPreviewWrap').hidden = true;
  document.getElementById('salesSheetError').textContent = '';
});

document.getElementById('submitCashUpBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('submitError');
  errEl.textContent = '';

  if (!document.getElementById('zReadingNo').value || !document.getElementById('grossSales').value) {
    errEl.textContent = 'Z Reading No. and Gross Sales are required.';
    return;
  }
  if (!document.getElementById('managerName').value) {
    errEl.textContent = 'Manager sign-off name is required.';
    return;
  }
  if (!document.getElementById('mBranch').value.trim()) {
    errEl.textContent = 'Choose a branch.';
    return;
  }

  // Shop expenses (Pro) travel with the cash-up as a separate PDF.
  let shopExpenses = [];
  if (featureOn('shopExpenses')) {
    const collected = collectShopExpenses();
    if (collected.error) {
      errEl.textContent = collected.error + ' (see the Shop Expenses tab)';
      return;
    }
    shopExpenses = collected.lines;
  }

  const donations = [];
  document.querySelectorAll('#donationsBody tr').forEach((row) => {
    const amount = Number(row.querySelector('.don-amount').value) || 0;
    const receiptNo = row.querySelector('.don-receipt').value;
    const receiptDate = row.querySelector('.don-date').value;
    if (amount > 0 || receiptNo) {
      donations.push({ receiptNo, amount, receiptDate });
    }
  });

  const data = {
    branch: document.getElementById('mBranch').value,
    date: document.getElementById('mDate').value,
    day: new Date(document.getElementById('mDate').value).toLocaleDateString('en-ZA', { weekday: 'long' }),
    casher: document.getElementById('mCasher').value,
    zReadingNo: document.getElementById('zReadingNo').value,
    grossSales: num('grossSales'),
    overingPaidAmount: num('overingPaidAmount'),
    cashRefundsAmount: num('cashRefundsAmount'),
    expensePaidAmount: num('expensePaidAmount'),
    cardSalesCount: num('cardSalesCount'),
    totalCardSales: num('totalCardSales'),
    r200: num('r200'), r100: num('r100'), r50: num('r50'), r20: num('r20'), r10: num('r10'),
    r5: num('r5'), r2: num('r2'), r1: num('r1'), c50: num('c50'), c20: num('c20'), c10: num('c10'), c5: num('c5'), c1: num('c1'),
    overingExplain: document.getElementById('overingExplain').value,
    refundsExplain: document.getElementById('refundsExplain').value,
    expensesExplain: document.getElementById('expensesExplain').value,
    shortOverExplain: document.getElementById('shortOverExplain').value,
    managerName: document.getElementById('managerName').value,
    floatAmount: num('floatAmount'),
    donations: donations,
    salesSheetImage: salesSheetImageDataUrl || ''
  };
  if (shopExpenses.length) data.shopExpenses = shopExpenses;

  const btn = document.getElementById('submitCashUpBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  const result = await apiPost('submitCashUp', { submittedByEmail: currentUser.email, data: data });
  btn.disabled = false; btn.textContent = 'Submit Cash-Up';

  if (!result.success) {
    if (result.networkError) {
      errEl.textContent = 'Lost connection confirming this submission — it may have already gone through. Please check with Back Office before submitting again, to avoid a duplicate entry.';
    } else {
      errEl.textContent = result.error || 'Submission failed. Please try again.';
    }
    return;
  }
  document.getElementById('submittedRef').textContent = 'Reference: ' + result.submissionId +
    (shopExpenses.length ? ' · ' + shopExpenses.length + ' shop expense' + (shopExpenses.length === 1 ? '' : 's') + ' included' : '') +
    (result.pdfWarning ? ' — note: ' + result.pdfWarning : '');
  if (shopExpenses.length) clearShopExpenses();
  showView('submitted');
});

document.getElementById('newCashUpBtn').addEventListener('click', () => {
  document.querySelectorAll('#view-manager input[type=number]').forEach((i) => { i.value = 0; });
  document.getElementById('zReadingNo').value = '';
  document.getElementById('grossSales').value = '';
  document.getElementById('totalCardSales').value = 0;
  document.getElementById('overingExplain').value = '';
  document.getElementById('refundsExplain').value = '';
  document.getElementById('expensesExplain').value = '';
  document.getElementById('shortOverExplain').value = '';
  document.getElementById('donationsBody').innerHTML = '';
  document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('#view-manager .from-till').forEach((x) => x.classList.remove('from-till'));
  salesSheetImageDataUrl = null;
  document.getElementById('salesSheetInput').value = '';
  document.getElementById('salesSheetPreviewWrap').hidden = true;
  document.getElementById('salesSheetError').textContent = '';
  recalcAll();
  if (currentUser && ROLE_PAGES[currentUser.role]) openPage('cashup'); else showView('manager');
});

// ─────────────────────────────────────────────────────────────────────
// SHOP EXPENSES (Pro feature "shopExpenses")
// Lines are kept on the page until the cash-up is submitted; each line can
// carry one receipt photo, compressed in the browser like the sales sheet.
// ─────────────────────────────────────────────────────────────────────

const EXPENSE_TYPES = ['Electricity', 'Repairs (Technical fees)', 'Rental', 'Utility (Water, etc)', 'Other'];
const MAX_EXPENSE_LINES = 15;
const expenseReceipts = new Map(); // line id -> compressed receipt data URL
let expenseLineSeq = 0;

function addExpenseLine() {
  const container = document.getElementById('expenseLines');
  if (container.children.length >= MAX_EXPENSE_LINES) {
    document.getElementById('expenseError').textContent = 'A maximum of ' + MAX_EXPENSE_LINES + ' expenses can be sent with one cash-up.';
    return;
  }
  const id = 'exp' + (++expenseLineSeq);
  const defaultDate = document.getElementById('mDate').value || new Date().toISOString().slice(0, 10);
  const div = document.createElement('div');
  div.className = 'expense-line';
  div.dataset.id = id;
  div.innerHTML =
    '<div class="expense-line-head"><strong class="expense-line-title"></strong>' +
      '<button type="button" class="link-btn expense-remove">Remove</button></div>' +
    '<div class="grid-2">' +
      '<label>Date <input type="date" class="exp-date" value="' + defaultDate + '"></label>' +
      '<label>Amount (R) <input type="number" step="0.01" min="0" class="exp-amount" inputmode="decimal"></label>' +
    '</div>' +
    '<label>Description <input type="text" class="exp-desc" maxlength="200" placeholder="What was paid for?"></label>' +
    shopExpenseCategoryHtml() +
    '<label>Receipt photo <input type="file" class="exp-file" accept="image/*" capture="environment"></label>' +
    '<div class="exp-preview-wrap" hidden><img class="exp-preview" alt="Receipt preview">' +
      '<button type="button" class="link-btn exp-photo-remove">Remove photo</button></div>' +
    '<p class="error-text exp-file-error"></p>';

  div.querySelector('.exp-amount').addEventListener('input', recalcShopExpenses);
  const majorSel = div.querySelector('.exp-major');
  if (majorSel) majorSel.addEventListener('change', () => fillSubSelect(div.querySelector('.exp-sub'), majorSel.value, false));
  div.querySelector('.exp-desc').addEventListener('input', updateShopExpBadge);
  div.querySelector('.expense-remove').addEventListener('click', () => {
    expenseReceipts.delete(id);
    div.remove();
    renumberExpenseLines();
    recalcShopExpenses();
  });
  div.querySelector('.exp-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const errEl = div.querySelector('.exp-file-error');
    errEl.textContent = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { errEl.textContent = 'Please choose an image file.'; e.target.value = ''; return; }
    try {
      const dataUrl = await resizeImageFileToDataUrl(file, SALES_SHEET_MAX_DIMENSION, SALES_SHEET_JPEG_QUALITY);
      expenseReceipts.set(id, dataUrl);
      div.querySelector('.exp-preview').src = dataUrl;
      div.querySelector('.exp-preview-wrap').hidden = false;
    } catch (err) {
      errEl.textContent = err.message || 'Could not process that photo. Please try another.';
    }
  });
  div.querySelector('.exp-photo-remove').addEventListener('click', () => {
    expenseReceipts.delete(id);
    div.querySelector('.exp-file').value = '';
    div.querySelector('.exp-preview-wrap').hidden = true;
  });

  container.appendChild(div);
  renumberExpenseLines();
  recalcShopExpenses();
  div.querySelector('.exp-desc').focus();
}

// Category + subcategory for a branch shop expense, from the shared list
// Admins manage under Head Office Finance → Categories.
function shopExpenseCategoryHtml() {
  if (!finSetup) {
    return '<label>Type <select class="exp-type">' + EXPENSE_TYPES.map((t) => '<option>' + escapeHtml(t) + '</option>').join('') + '</select></label>';
  }
  const majors = finSetup.majors.filter((m) => m.kind === 'Expense' && !m.hidden && m.subs.some((x) => x.active));
  return '<div class="grid-2">' +
    '<label>Category <select class="exp-major"><option value="">Choose…</option>' +
      majors.map((m) => '<option value="' + escapeAttr(m.key) + '">' + escapeHtml(m.name) + '</option>').join('') + '</select></label>' +
    '<label>Subcategory <select class="exp-sub"><option value="">Choose a category first</option></select></label>' +
    '</div>';
}

function renumberExpenseLines() {
  const lines = document.querySelectorAll('#expenseLines .expense-line');
  lines.forEach((el, i) => { el.querySelector('.expense-line-title').textContent = 'Expense ' + (i + 1); });
  document.getElementById('expenseEmpty').hidden = lines.length > 0;
  document.getElementById('expenseError').textContent = '';
}

function recalcShopExpenses() {
  let total = 0;
  document.querySelectorAll('#expenseLines .exp-amount').forEach((i) => { total += Number(i.value) || 0; });
  document.getElementById('totalShopExpenses').textContent = rand(total);
  updateShopExpBadge();
}

function updateShopExpBadge() {
  const badge = document.getElementById('shopExpBadge');
  if (!badge) return;
  const n = document.querySelectorAll('#expenseLines .expense-line').length;
  badge.textContent = n;
  badge.hidden = n === 0;
}

// Returns { lines } or { error }. Blank lines are skipped.
function collectShopExpenses() {
  const lines = [];
  const els = document.querySelectorAll('#expenseLines .expense-line');
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const description = el.querySelector('.exp-desc').value.trim();
    const amount = Number(el.querySelector('.exp-amount').value) || 0;
    const receiptImage = expenseReceipts.get(el.dataset.id) || '';
    if (!description && !amount && !receiptImage) continue;
    if (!description || amount <= 0) return { error: 'Shop expense ' + (i + 1) + ' needs a description and an amount.' };
    const line = { date: el.querySelector('.exp-date').value, description, amount, receiptImage };
    const subSel = el.querySelector('.exp-sub');
    if (subSel) {
      if (!subSel.value) return { error: 'Choose a category for shop expense ' + (i + 1) + '.' };
      line.subId = subSel.value;
    } else {
      line.type = el.querySelector('.exp-type').value; // backend not updated yet
    }
    lines.push(line);
  }
  return { lines };
}

function clearShopExpenses() {
  document.getElementById('expenseLines').innerHTML = '';
  expenseReceipts.clear();
  renumberExpenseLines();
  recalcShopExpenses();
}

document.getElementById('addExpenseBtn').addEventListener('click', async () => {
  if (!finSetup && featureOn('shopExpenses')) await ensureFinanceSetup();
  addExpenseLine();
});

// Shared renderer for Shop expense submissions (Admin Submissions tab and Back Office).
async function loadExpenseSubmissions(listEl, email, branch) {
  listEl.innerHTML = '<p class="muted">Loading…</p>';
  const result = await apiGet('shopExpenses', { email: email, branch: branch || '' });
  if (!result.success) { listEl.innerHTML = '<p class="error-text">' + escapeHtml(result.error) + '</p>'; return; }
  if (!result.submissions.length) { listEl.innerHTML = '<p class="muted">No shop expenses submitted yet.</p>'; return; }
  listEl.innerHTML = result.submissions.map((sub) =>
    '<div class="expense-sub">' +
      '<div class="expense-sub-head">' +
        '<div><strong>' + escapeHtml(sub.branch) + '</strong> — cash-up ' + escapeHtml(formatDayOnly(sub.cashUpDate)) +
          '<div class="muted expense-sub-meta">Submitted ' + escapeHtml(formatShortDateTime(sub.submittedAt)) +
          (sub.submittedBy ? ' by ' + escapeHtml(sub.submittedBy) : '') + '</div></div>' +
        '<div class="expense-sub-total"><strong>' + rand(sub.total) + '</strong>' +
          fileButton(sub.pdfFile, 'PDF') + '</div>' +
      '</div>' +
      '<ul class="expense-sub-lines">' + sub.lines.map((l) =>
        '<li><span class="exp-l-desc">' + escapeHtml(l.description) + '</span>' +
        '<span class="exp-l-type">' + escapeHtml(l.type) + '</span>' +
        '<span class="exp-l-amt">' + rand(l.amount) + '</span>' +
        (l.receiptFile ? fileButton(l.receiptFile, 'Receipt') : '<span class="muted">No receipt</span>') +
        '</li>').join('') +
      '</ul>' +
    '</div>'
  ).join('');
}

function formatDayOnly(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

// ─────────────────────────────────────────────────────────────────────
// ADMIN VIEW
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// ADMIN VIEW — tab switching
// ─────────────────────────────────────────────────────────────────────

let adminTabsInitialised = false;

function initAdminTabs(adminEmail) {
  if (!adminTabsInitialised) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab, adminEmail));
    });
    adminTabsInitialised = true;
  }
  switchAdminTab('approvals', adminEmail);
}

function switchAdminTab(tab, adminEmail) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.admin-tab-panel').forEach((p) => { p.hidden = (p.id !== 'admin-tab-' + tab); });
  document.body.classList.toggle('wide-admin', tab === 'dashboard' || tab === 'approvals');

  if (tab === 'approvals') loadAdminView(adminEmail);
  else if (tab === 'submissions') loadAdminSubmissions(adminEmail);
  else if (tab === 'dashboard') initAdminDashboard(adminEmail);
}

// ─────────────────────────────────────────────────────────────────────
// ADMIN VIEW — Dashboard (redesign)
// ─────────────────────────────────────────────────────────────────────

// Fixed categorical hues (dataviz-validated order) — assigned by a branch's
// position in the org's Branches list, never by its current sales rank, so
// a branch keeps the same colour everywhere even as filters/sorting change.
const DASH_SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
let dashBranchOrder = [];
function colorForBranch(branch) {
  let i = dashBranchOrder.indexOf(branch);
  if (i === -1) i = dashBranchOrder.length; // unknown/legacy branch — falls after the known list
  return DASH_SERIES_COLORS[i % DASH_SERIES_COLORS.length];
}

let dashInitialised = false;
let dashCharts = {};
let dashAdminEmail = null;

function initAdminDashboard(adminEmail) {
  dashAdminEmail = adminEmail;
  if (!dashInitialised) {
    document.getElementById('dashPeriod').addEventListener('change', () => {
      document.getElementById('dashFromWrap').hidden = document.getElementById('dashPeriod').value !== 'custom';
      document.getElementById('dashToWrap').hidden = document.getElementById('dashPeriod').value !== 'custom';
      loadAdminDashboard();
    });
    document.getElementById('dashBranch').addEventListener('change', loadAdminDashboard);
    document.getElementById('dashFrom').addEventListener('change', loadAdminDashboard);
    document.getElementById('dashTo').addEventListener('change', loadAdminDashboard);

    const shortOverCard = document.getElementById('kpiShortOverCard');
    shortOverCard.addEventListener('click', openShortOverModal);
    shortOverCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShortOverModal(); }
    });
    document.getElementById('shortOverModalClose').addEventListener('click', closeShortOverModal);
    document.getElementById('shortOverModalBackdrop').addEventListener('click', (e) => {
      if (e.target.id === 'shortOverModalBackdrop') closeShortOverModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('shortOverModalBackdrop').hidden) closeShortOverModal();
    });

    dashInitialised = true;
  }
  loadAdminDashboard();
}

function closeShortOverModal() {
  document.getElementById('shortOverModalBackdrop').hidden = true;
}

async function openShortOverModal() {
  const period = document.getElementById('dashPeriod').value;
  const branch = document.getElementById('dashBranch').value;
  const from = document.getElementById('dashFrom').value;
  const to = document.getElementById('dashTo').value;

  const backdrop = document.getElementById('shortOverModalBackdrop');
  const body = document.getElementById('shortOverModalBody');
  const subtitle = document.getElementById('shortOverModalSubtitle');
  backdrop.hidden = false;
  body.innerHTML = '<p class="muted">Loading…</p>';
  subtitle.textContent = '';

  const result = await apiGet('shortOverDetail', { email: dashAdminEmail, period, branch, from, to });
  if (!result.success) {
    body.innerHTML = '<p class="error-text">' + escapeHtml(result.error || 'Could not load the breakdown.') + '</p>';
    return;
  }

  const balancedNote = result.balancedCount
    ? ' · ' + result.balancedCount + ' balanced submission' + (result.balancedCount === 1 ? '' : 's') + ' not shown'
    : '';
  subtitle.textContent =
    formatDateOnly(result.range.from) + ' – ' + formatDateOnly(result.range.to) +
    (result.branch !== 'All Branches' ? ' · ' + result.branch : '') +
    ' · Net ' + rand(result.totalShortOver) + balancedNote;

  if (result.rows.length === 0) {
    body.innerHTML = '<p class="muted">Every submission in this period balanced to R 0.00 — nothing to review.</p>';
    return;
  }

  body.innerHTML = result.rows.map((r) => {
    // Every row here is already a non-zero discrepancy (balanced rows are
    // filtered out by the backend), so state is always over or short.
    const state = r.shortOverAmount > 0 ? 'over' : 'short';
    const label = r.shortOverAmount > 0 ? 'OVER' : 'SHORT';
    const explain = (r.shortOverExplain || '').trim();
    return (
      '<div class="short-over-row">' +
        '<div class="short-over-row-head">' +
          '<div>' +
            '<div class="short-over-row-branch">' + escapeHtml(r.branch) + '</div>' +
            '<div class="short-over-row-date">' + formatDateOnly(r.date) + (r.cashier ? ' · ' + escapeHtml(r.cashier) : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div class="short-over-row-amount state-' + state + '">' + rand(r.shortOverAmount) + '</div>' +
            '<div class="kpi-badge" style="margin-top:4px;background:var(--status-' + (state === 'balanced' ? 'good' : state === 'over' ? 'warning' : 'critical') + ');">' + label + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="short-over-row-explain' + (explain ? '' : ' is-empty') + '">' +
          (explain ? escapeHtml(explain) : 'No explanation recorded.') +
        '</div>' +
        (r.pdfFile ? '<div style="margin-top:6px;">' + fileButton(r.pdfFile, 'View PDF') + '</div>' : '') +
      '</div>'
    );
  }).join('');
}

function destroyChart(id) {
  if (dashCharts[id]) { dashCharts[id].destroy(); delete dashCharts[id]; }
}

async function loadAdminDashboard() {
  const period = document.getElementById('dashPeriod').value;
  const branch = document.getElementById('dashBranch').value;
  const from = document.getElementById('dashFrom').value;
  const to = document.getElementById('dashTo').value;

  const loadingEl = document.getElementById('dashLoading');
  loadingEl.hidden = false;
  loadingEl.textContent = 'Loading dashboard…';
  loadingEl.classList.remove('error-text');
  document.getElementById('dashContent').hidden = true;

  const result = await apiGet('dashboardV2', { email: dashAdminEmail, period, branch, from, to });
  if (!result.success) {
    document.getElementById('dashLoading').textContent = result.error || 'Could not load the dashboard.';
    document.getElementById('dashLoading').classList.add('error-text');
    return;
  }
  document.getElementById('dashLoading').hidden = true;
  document.getElementById('dashContent').hidden = false;

  // Populate the branch dropdown once, keeping the admin's current selection.
  const branchSelect = document.getElementById('dashBranch');
  if (dashBranchOrder.length === 0 && result.branches && result.branches.length) {
    dashBranchOrder = result.branches.slice();
    const current = branchSelect.value;
    result.branches.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      branchSelect.appendChild(opt);
    });
    branchSelect.value = current;
  }

  document.getElementById('dashRangeLabel').textContent =
    'Showing ' + formatDateOnly(result.range.from) + ' – ' + formatDateOnly(result.range.to) +
    (result.branch !== 'All Branches' ? ' · ' + result.branch : '');

  renderKpis(result.kpis);
  renderNettTrendChart(result);
  renderByBranchChart(result.byBranch);
  renderByBranchTable(result.byBranch);
  renderSubmissionsChart(result);
  renderComparisonChart(result.kpis);
  renderMonthlyHistoryChart(result);
  renderBranchOverTimeChart(result);
}

function formatDateOnly(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderKpis(kpis) {
  document.getElementById('kpiCount').textContent = kpis.count;
  document.getElementById('kpiNett').textContent = rand(kpis.totalNettSales);
  document.getElementById('kpiCards').textContent = rand(kpis.totalCardsAndCash);
  document.getElementById('kpiDonations').textContent = rand(kpis.totalDonations);
  document.getElementById('kpiShortOver').textContent = rand(kpis.totalShortOver);

  const card = document.getElementById('kpiShortOverCard');
  const badge = document.getElementById('kpiShortOverBadge');
  let state, label;
  if (Math.abs(kpis.totalShortOver) < 0.005) { state = 'balanced'; label = 'BALANCED'; }
  else if (kpis.totalShortOver > 0) { state = 'over'; label = 'OVER'; }
  else { state = 'short'; label = 'SHORT'; }
  card.dataset.state = state;
  badge.textContent = label;
}

// Shared look for the hover/crosshair tooltip and axis ink across every chart.
function baseChartOptions(extra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#142132', titleColor: '#fff', bodyColor: '#fff',
        padding: 10, cornerRadius: 6, displayColors: true
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#5e6a7a', font: { size: 11 } } },
      y: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 } }, beginAtZero: true }
    }
  }, extra || {});
}

function renderNettTrendChart(result) {
  document.getElementById('trendGranularityLabel').textContent = '(' + result.granularity + ')';
  const ctx = document.getElementById('chartNettTrend');
  destroyChart('nettTrend');
  dashCharts.nettTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: result.trend.map((t) => t.label),
      datasets: [{
        label: 'Nett Sales',
        data: result.trend.map((t) => t.nettSales),
        borderColor: '#2a78d6',
        backgroundColor: 'rgba(42,120,214,0.12)',
        pointBackgroundColor: '#2a78d6',
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        fill: true,
        tension: 0.25
      }]
    },
    options: baseChartOptions({
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#142132', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 6,
          callbacks: { label: (c) => ' Nett Sales: ' + rand(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5e6a7a', font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, callback: (v) => rand(v) }, beginAtZero: true }
      }
    })
  });
}

function renderByBranchChart(byBranch) {
  const ctx = document.getElementById('chartByBranch');
  destroyChart('byBranch');
  dashCharts.byBranch = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: byBranch.map((b) => b.branch),
      datasets: [{
        label: 'Nett Sales',
        data: byBranch.map((b) => b.totalNettSales),
        backgroundColor: byBranch.map((b) => colorForBranch(b.branch)),
        borderRadius: 4,
        maxBarThickness: 46
      }]
    },
    options: baseChartOptions({
      indexAxis: 'y',
      // Horizontal bars: the nearest-item search must look along the y-axis
      // (the category axis here), not the default x — otherwise the tooltip
      // tracks the wrong bar until the mouse moves very slowly.
      interaction: { mode: 'nearest', intersect: true, axis: 'y' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#142132', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 6,
          callbacks: { label: (c) => ' Nett Sales: ' + rand(c.parsed.x) }
        }
      },
      scales: {
        x: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, callback: (v) => rand(v) }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { color: '#142132', font: { size: 12, weight: '700' } } }
      }
    })
  });
}

function renderByBranchTable(byBranch) {
  const tbody = document.getElementById('dashByBranchBody');
  tbody.innerHTML = '';
  byBranch.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + escapeHtml(b.branch) + '</td><td>' + b.count + '</td><td>' + rand(b.totalNettSales) + '</td><td>' + rand(b.totalDonations) + '</td>';
    tbody.appendChild(tr);
  });
}

function renderSubmissionsChart(result) {
  const ctx = document.getElementById('chartSubmissions');
  destroyChart('submissions');
  dashCharts.submissions = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: result.trend.map((t) => t.label),
      datasets: [{
        label: 'Submissions',
        data: result.trend.map((t) => t.submissions),
        backgroundColor: '#eb6834',
        borderRadius: 4,
        maxBarThickness: 28
      }]
    },
    options: baseChartOptions({
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5e6a7a', font: { size: 10 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, precision: 0 }, beginAtZero: true }
      }
    })
  });
}

function renderComparisonChart(kpis) {
  const ctx = document.getElementById('chartComparison');
  destroyChart('comparison');
  const rows = [
    { label: 'Nett Sales', value: kpis.totalNettSales, color: '#2a78d6' },
    { label: 'Card Sales', value: kpis.totalCardSales, color: '#eb6834' },
    { label: 'Cash Sales', value: kpis.totalCashOnly, color: '#1baf7a' },
    { label: 'Donations', value: kpis.totalDonations, color: '#eda100' }
  ];
  dashCharts.comparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderRadius: 4,
        maxBarThickness: 60
      }]
    },
    options: baseChartOptions({
      indexAxis: 'y',
      // Horizontal bars: nearest-item search must look along the y-axis
      // (the category axis here), not the default x.
      interaction: { mode: 'nearest', intersect: true, axis: 'y' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#142132', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 6,
          callbacks: { label: (c) => ' ' + rand(c.parsed.x) }
        }
      },
      scales: {
        x: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, callback: (v) => rand(v) }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { color: '#142132', font: { size: 12, weight: '700' } } }
      }
    })
  });
}

function renderMonthlyHistoryChart(result) {
  const note = document.getElementById('monthlyHistoryBranchNote');
  note.textContent = result.branch !== 'All Branches' ? ' for ' + result.branch : '';
  const ctx = document.getElementById('chartMonthlyHistory');
  destroyChart('monthlyHistory');
  dashCharts.monthlyHistory = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: result.monthlyHistory.map((m) => m.label),
      datasets: [{
        label: 'Nett Sales',
        data: result.monthlyHistory.map((m) => m.nettSales),
        backgroundColor: '#1baf7a',
        borderRadius: 4,
        maxBarThickness: 46
      }]
    },
    options: baseChartOptions({
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#142132', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 6,
          callbacks: { label: (c) => ' Nett Sales: ' + rand(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5e6a7a', font: { size: 11 } } },
        y: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, callback: (v) => rand(v) }, beginAtZero: true }
      }
    })
  });
}

function renderBranchOverTimeChart(result) {
  const ctx = document.getElementById('chartBranchOverTime');
  destroyChart('branchOverTime');
  const labels = result.trend.map((t) => t.label);
  const series = (result.trendByBranch || []).slice(0, 8); // categorical cap — see dataviz skill non-negotiables
  const twoOrMore = series.length >= 2;
  dashCharts.branchOverTime = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.branch,
        data: s.series,
        borderColor: colorForBranch(s.branch),
        backgroundColor: colorForBranch(s.branch),
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.25,
        fill: false
      }))
    },
    options: baseChartOptions({
      plugins: {
        legend: { display: twoOrMore, position: 'bottom', labels: { color: '#142132', boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: {
          backgroundColor: '#142132', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 6,
          callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + rand(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5e6a7a', font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, callback: (v) => rand(v) }, beginAtZero: true }
      }
    })
  });
}

let adminSubSwitchBound = false;
async function loadAdminSubmissions(adminEmail) {
  const switchEl = document.getElementById('adminSubSwitch');
  switchEl.hidden = !featureOn('shopExpenses');
  if (!adminSubSwitchBound) {
    adminSubSwitchBound = true;
    switchEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      switchEl.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      const showExp = b.dataset.sub === 'expenses';
      document.getElementById('adminSubCashups').hidden = showExp;
      document.getElementById('adminSubExpenses').hidden = !showExp;
      if (showExp) loadExpenseSubmissions(document.getElementById('adminExpenseList'), currentUser.email, '');
    }));
  }
  if (switchEl.hidden) {
    document.getElementById('adminSubCashups').hidden = false;
    document.getElementById('adminSubExpenses').hidden = true;
  } else if (!document.getElementById('adminSubExpenses').hidden) {
    loadExpenseSubmissions(document.getElementById('adminExpenseList'), adminEmail, '');
  }
  const result = await apiGet('recentSubmissions', { email: adminEmail, branch: '' });
  const listEl = document.getElementById('adminRecentList');
  listEl.innerHTML = '';
  if (!result.success) { listEl.innerHTML = '<p class="error-text">' + result.error + '</p>'; return; }
  result.submissions.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'recent-row';
    div.innerHTML =
      '<span>' + escapeHtml(s.branch) + ' — ' + formatDateTime(s.timestamp) + '</span>' +
      '<span>' + fileButton(s.pdfFile, 'PDF') + '</span>';
    listEl.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────────────────
// ADMIN VIEW — Approvals tab: "Pending requests" + "All users"
// ─────────────────────────────────────────────────────────────────────

const ROLE_LABELS = { Manager: 'Store Manager', BackOffice: 'Back Office', Admin: 'Admin', Developer: 'Developer' };
let adminUsers = [];        // every row of the Users sheet (from 'allUsers')
let adminUserBranches = []; // branch list for the edit dialog
let adminFinanceMajors = []; // finance categories that can be hidden from Back Office users
let usersAdminEmail = null;
let usersUiInitialised = false;
let editingUser = null;
let adminLoadSeq = 0;       // ignores stale responses if the tab is reloaded quickly

async function loadAdminView(adminEmail) {
  usersAdminEmail = adminEmail;
  initUsersUi();
  const seq = ++adminLoadSeq;

  document.getElementById('usersLoading').hidden = false;
  document.getElementById('usersError').hidden = true;

  const [pendingRes, usersRes, logRes] = await Promise.all([
    apiGet('pendingUsers', { email: adminEmail }),
    apiGet('allUsers', { email: adminEmail }),
    apiGet('accessLog', { email: adminEmail })
  ]);
  if (seq !== adminLoadSeq) return;
  renderAccessLog(logRes);

  renderPendingRequests(pendingRes, adminEmail);

  document.getElementById('usersLoading').hidden = true;
  if (!usersRes.success) {
    const err = document.getElementById('usersError');
    err.textContent = usersRes.error === 'Unknown action'
      ? 'The "All users" list needs the updated Apps Script. Redeploy it (Manage deployments → Edit → New version), then refresh.'
      : (usersRes.error || 'Could not load users.');
    err.hidden = false;
    document.getElementById('usersTableWrap').hidden = true;
    document.getElementById('usersEmpty').hidden = true;
    document.getElementById('usersCount').textContent = '';
    return;
  }
  adminUsers = usersRes.users || [];
  adminUserBranches = usersRes.branches || [];
  adminFinanceMajors = usersRes.financeMajors || [];
  renderUsersTable();
}

// Access log: who approved / changed whose access, sign-ins, "view as".
let accessLogItems = [];
let accessLogAll = false;
function renderAccessLog(res) {
  const el = document.getElementById('accessLogList');
  const more = document.getElementById('accessLogMore');
  if (!more.dataset.bound) {
    more.dataset.bound = '1';
    more.addEventListener('click', () => { accessLogAll = !accessLogAll; renderAccessLog(null); });
  }
  if (res) {
    if (!res.success) {
      el.innerHTML = '<p class="muted">' + escapeHtml(res.error === 'Unknown action' ? 'The access log needs the updated Apps Script.' : (res.error || 'Could not load the access log.')) + '</p>';
      more.hidden = true;
      return;
    }
    accessLogItems = res.items || [];
  }
  const shown = accessLogAll ? accessLogItems : accessLogItems.slice(0, 15);
  el.innerHTML = shown.length ? shown.map((x) => {
    const self = sameEmail(x.by, x.user) || !x.user;
    const who = '<strong>' + escapeHtml(x.byName || x.by || 'Someone') + '</strong>';
    const what = self ? ' ' + escapeHtml(x.action.charAt(0).toLowerCase() + x.action.slice(1))
      : ' ' + escapeHtml(x.action.toLowerCase().replace('changed access', 'changed access for').replace(/^approved$/, 'approved').replace(/^rejected$/, 'rejected')) +
        ' <strong>' + escapeHtml(x.userName || x.user) + '</strong>';
    return '<div class="access-row"><span class="access-when">' + escapeHtml(formatShortDateTime(x.timestamp)) + '</span>' +
      '<span class="access-what">' + who + what + (x.details ? '<span class="access-details">' + escapeHtml(x.details) + '</span>' : '') + '</span></div>';
  }).join('') : '<p class="muted">Nothing recorded yet. Approvals, access changes and sign-ins will appear here.</p>';
  more.hidden = accessLogItems.length <= 15;
  more.textContent = accessLogAll ? 'Show fewer' : 'Show all ' + accessLogItems.length;
}

// Pending requests — same Approve / Reject behaviour as before; after an
// action the whole tab reloads so the "All users" table updates too.
function renderPendingRequests(result, adminEmail) {
  const listEl = document.getElementById('pendingList');
  const noneEl = document.getElementById('noPending');
  listEl.innerHTML = '';

  if (!result.success) {
    noneEl.hidden = true;
    listEl.innerHTML = '<p class="error-text">' + escapeHtml(result.error) + '</p>';
    return;
  }
  if (result.pending.length === 0) {
    noneEl.hidden = false;
    return;
  }
  noneEl.hidden = true;

  result.pending.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'pending-row';
    const branchOptions = result.branches.map((b) =>
      '<option value="' + escapeAttr(b) + '"' + (b === p.requestedBranch ? ' selected' : '') + '>' + escapeHtml(b) + '</option>'
    ).join('');
    div.innerHTML =
      '<div class="name">' + escapeHtml(p.fullName) + '</div>' +
      '<div class="muted">' + escapeHtml(formatContact(p.contact)) + ' · ' + escapeHtml(p.email) + '</div>' +
      '<div class="muted">Requested branch: ' + escapeHtml(p.requestedBranch || '—') + '</div>' +
      '<div class="pending-actions">' +
        '<select class="role-select"><option value="Manager">Store Manager</option><option value="BackOffice">Back Office</option><option value="Admin">Admin</option>' +
          (featureOn('deliveries') ? '<option value="Driver">Driver</option>' : '') + '</select>' +
        '<select class="branch-select">' + branchOptions + '</select>' +
        '<button class="btn-approve">Approve</button>' +
        '<button class="btn-reject">Reject</button>' +
      '</div>';

    // Drivers are shared across all branches.
    div.querySelector('.role-select').addEventListener('change', (e) => {
      const branchSel = div.querySelector('.branch-select');
      const allOpt = branchSel.querySelector('option[value="All branches"]');
      if (e.target.value === 'Driver') {
        if (!allOpt) branchSel.insertAdjacentHTML('afterbegin', '<option value="All branches">All branches</option>');
        branchSel.value = 'All branches';
        branchSel.disabled = true;
      } else {
        if (allOpt) allOpt.remove();
        branchSel.disabled = false;
      }
    });
    div.querySelector('.btn-approve').addEventListener('click', async () => {
      const role = div.querySelector('.role-select').value;
      const branch = div.querySelector('.branch-select').value;
      div.querySelector('.btn-approve').disabled = true;
      const res = await apiPost('approveUser', { requesterEmail: adminEmail, targetEmail: p.email, role, branch });
      if (res.success) { loadAdminView(adminEmail); } else { alert(res.error); div.querySelector('.btn-approve').disabled = false; }
    });
    div.querySelector('.btn-reject').addEventListener('click', async () => {
      if (!confirm('Reject ' + p.fullName + '\'s registration?')) return;
      div.querySelector('.btn-reject').disabled = true;
      const res = await apiPost('rejectUser', { requesterEmail: adminEmail, targetEmail: p.email });
      if (res.success) { loadAdminView(adminEmail); } else { alert(res.error); div.querySelector('.btn-reject').disabled = false; }
    });

    listEl.appendChild(div);
  });
}

function initUsersUi() {
  if (usersUiInitialised) return;
  usersUiInitialised = true;

  document.getElementById('usersSearch').addEventListener('input', renderUsersTable);
  document.getElementById('usersStatusFilter').addEventListener('change', renderUsersTable);

  document.getElementById('usersTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('.user-edit-btn');
    if (!btn) return;
    const user = adminUsers.find((u) => sameEmail(u.email, btn.dataset.email));
    if (user) openUserEdit(user);
  });

  document.getElementById('userEditClose').addEventListener('click', closeUserEdit);
  document.getElementById('userEditCancel').addEventListener('click', closeUserEdit);
  // A form: only X or Cancel closes it, so a stray click doesn't lose changes.
  guardModalBackdrop('userEditBackdrop');
  document.getElementById('userEditStatus').addEventListener('change', updateUserEditNote);
  document.getElementById('userEditRole').addEventListener('change', updateUserEditNote);
  document.getElementById('userEditSave').addEventListener('click', saveUserEdit);
}

function renderUsersTable() {
  const filter = document.getElementById('usersStatusFilter').value;
  const q = document.getElementById('usersSearch').value.trim().toLowerCase();

  const rows = adminUsers.filter((u) => {
    const status = u.status || '';
    if (filter === 'default' && status === 'Rejected') return false;
    if (filter !== 'default' && filter !== 'all' && status !== filter) return false;
    if (!q) return true;
    const hay = [u.fullName, u.email, formatContact(u.contact), u.requestedBranch, u.branch, ROLE_LABELS[u.role] || u.role]
      .join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  const body = document.getElementById('usersTableBody');
  body.innerHTML = rows.map((u) => {
    const isPending = u.status === 'Pending';
    const action = isPending
      ? '<span class="muted users-review">Review above</span>'
      : '<button type="button" class="user-edit-btn" data-email="' + escapeAttr(u.email) + '">Edit</button>';
    return '<tr>' +
      '<td class="nowrap">' + dateCell(u.timestamp) + '</td>' +
      '<td class="col-name">' + escapeHtml(u.fullName) + '</td>' +
      '<td>' + escapeHtml(u.requestedBranch || '—') + '</td>' +
      '<td>' + statusTag(u.status) + '</td>' +
      '<td class="nowrap">' + escapeHtml(ROLE_LABELS[u.role] || u.role || '—') +
        (u.role === 'BackOffice' && u.status === 'Approved' && ((u.hiddenFinance || []).length || u.manageDeliveries)
          ? '<span class="perm-tags">' + ((u.hiddenFinance || []).length ? '<span class="perm-tag">' + u.hiddenFinance.length + ' hidden</span>' : '') +
            (u.manageDeliveries ? '<span class="perm-tag">Deliveries</span>' : '') + '</span>' : '') + '</td>' +
      '<td>' + escapeHtml(u.branch || '—') + '</td>' +
      '<td class="nowrap">' + dateCell(u.approvedDate) + '</td>' +
      '<td class="users-action">' + action + '</td>' +
    '</tr>';
  }).join('');

  const total = adminUsers.length;
  const rejectedCount = adminUsers.filter((u) => u.status === 'Rejected').length;
  let countText = rows.length === total ? total + ' user' + (total === 1 ? '' : 's') : 'Showing ' + rows.length + ' of ' + total;
  if (filter === 'default' && rejectedCount > 0) countText += ' · ' + rejectedCount + ' rejected hidden';
  document.getElementById('usersCount').textContent = countText;

  document.getElementById('usersTableWrap').hidden = rows.length === 0;
  document.getElementById('usersEmpty').hidden = rows.length !== 0;
}

function statusTag(status) {
  const s = status || 'Unknown';
  const cls = { Approved: 'tag-approved', Pending: 'tag-pending', Rejected: 'tag-rejected', Inactive: 'tag-inactive' }[s] || 'tag-inactive';
  return '<span class="status-tag ' + cls + '">' + escapeHtml(s) + '</span>';
}

// ── Edit dialog ──────────────────────────────────────────────────────

function openUserEdit(user) {
  editingUser = user;
  const isSelf = sameEmail(user.email, usersAdminEmail);

  document.getElementById('userEditTitle').textContent = 'Edit ' + (user.fullName || 'user');
  // Email, contact and Approved by aren't columns in the table (to keep it narrow),
  // so they show here.
  const contact = formatContact(user.contact);
  const tel = String(contact || '').replace(/[^\d+]/g, '');
  document.getElementById('userEditSubtitle').innerHTML = escapeHtml(user.email) +
    (contact ? ' · <a href="tel:' + escapeAttr(tel) + '" style="color:inherit">' + escapeHtml(contact) + '</a>' : '');
  document.getElementById('userEditInfo').textContent = user.approvedBy
    ? 'Approved by ' + user.approvedBy + (user.approvedDate ? ' on ' + formatShortDateTime(user.approvedDate) : '') : '';
  document.getElementById('userEditInfo').hidden = !user.approvedBy;

  const statusSel = document.getElementById('userEditStatus');
  statusSel.value = ['Approved', 'Inactive', 'Rejected'].indexOf(user.status) !== -1 ? user.status : 'Approved';
  statusSel.disabled = isSelf;

  // Developer is never offered as a choice: it's only given via "Add developer",
  // and a developer's role stays Developer.
  const roleSel = document.getElementById('userEditRole');
  const isDevTarget = user.role === 'Developer';
  const roleChoices = isDevTarget ? ['Developer']
    : ['Manager', 'BackOffice', 'Admin'].concat(featureOn('deliveries') || user.role === 'Driver' ? ['Driver'] : []);
  roleSel.innerHTML = roleChoices.map((r) => '<option value="' + r + '">' + ROLE_LABELS[r] + '</option>').join('');
  roleSel.value = roleChoices.indexOf(user.role) !== -1 ? user.role : roleChoices[0];
  roleSel.disabled = isSelf || isDevTarget;

  // Keep the user's current branch selectable even if it isn't in the
  // Branches tab (e.g. "Head Office" on the first admin's row).
  const branchSel = document.getElementById('userEditBranch');
  const branches = adminUserBranches.slice();
  const current = user.branch || user.requestedBranch || '';
  if (current && branches.indexOf(current) === -1) branches.unshift(current);
  branchSel.innerHTML = branches.map((b) =>
    '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  if (current) branchSel.value = current;

  const meta = [];
  if (user.lastEditedBy) meta.push('Last edited by ' + user.lastEditedBy + (user.lastEditedDate ? ' on ' + formatShortDateTime(user.lastEditedDate) : ''));
  document.getElementById('userEditMeta').textContent = meta.join(' · ');

  document.getElementById('userEditError').textContent = '';
  const saveBtn = document.getElementById('userEditSave');
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save changes';

  // Signed-in devices (sign-in codes) + sign out everywhere.
  const sess = document.getElementById('userEditSessions');
  const devices = user.signedInDevices || 0;
  sess.hidden = isSelf || (!(currentUser && currentUser.signInCodes) && !devices);
  document.getElementById('userEditSessionsText').textContent = devices
    ? 'Signed in on ' + devices + ' device' + (devices === 1 ? '' : 's') + '.' : 'Not signed in on any device.';
  document.getElementById('userEditSignOut').hidden = !devices;
  document.getElementById('userEditSignOut').disabled = false;

  // Back Office access: finance categories they can see + deliveries rights.
  const hidden = user.hiddenFinance || [];
  const group = (kind) => adminFinanceMajors.filter((m) => m.kind === kind);
  document.getElementById('userEditFinCats').innerHTML = ['Expense', 'Income'].map((kind) =>
    '<div class="user-perms-group"><span class="user-perms-kind">' + (kind === 'Expense' ? 'Expenses' : 'Income') + '</span>' +
    group(kind).map((m) => '<label class="fin-check"><input type="checkbox" class="perm-cat" value="' + escapeAttr(m.key) + '"' +
      (hidden.indexOf(m.key) === -1 ? ' checked' : '') + '> ' + escapeHtml(m.name) + '</label>').join('') + '</div>').join('');
  document.getElementById('userEditFinWrap').hidden = !featureOn('hoExpenses') && !featureOn('downloads');
  document.getElementById('userEditDelWrap').hidden = !featureOn('deliveries');
  document.querySelectorAll('input[name="userEditDel"]').forEach((r) => { r.checked = r.value === (user.manageDeliveries ? 'manage' : 'view'); });

  updateUserEditNote();
  document.getElementById('userEditBackdrop').hidden = false;
  (isSelf ? branchSel : statusSel).focus();
}

function updateUserEditNote() {
  if (!editingUser) return;
  const note = document.getElementById('userEditNote');
  const status = document.getElementById('userEditStatus').value;
  const role = document.getElementById('userEditRole').value;

  // Drivers are shared across all branches, so their branch is fixed.
  const branchSel = document.getElementById('userEditBranch');
  if (role === 'Driver') {
    if (!Array.from(branchSel.options).some((o) => o.value === 'All branches')) {
      branchSel.insertAdjacentHTML('afterbegin', '<option value="All branches">All branches</option>');
    }
    branchSel.value = 'All branches';
    branchSel.disabled = true;
  } else {
    branchSel.disabled = false;
    const allOpt = branchSel.querySelector('option[value="All branches"]');
    if (allOpt && editingUser.role !== 'Developer') allOpt.remove();
  }
  let text = '';
  if (sameEmail(editingUser.email, usersAdminEmail)) {
    text = 'This is your own account. You can change your branch, but not your own status or role.';
  } else if (editingUser.role === 'Developer' && status === 'Inactive') {
    text = 'They won\'t be able to sign in as a developer. Switch them back on here at any time.';
  } else if (status === 'Inactive') {
    text = 'They won\'t be able to use the app or receive cash-up emails. Their role and branch are kept, so you can switch them back on later.';
  } else if (status === 'Approved' && editingUser.status !== 'Approved') {
    text = 'This switches their access back on and emails them to say they\'re approved.';
  } else if (status === 'Approved' && role !== editingUser.role) {
    text = 'The new role applies the next time they open the app.';
  }
  note.textContent = text;
  note.hidden = !text;
  const perms = document.getElementById('userEditPerms');
  perms.hidden = role !== 'BackOffice' || (document.getElementById('userEditFinWrap').hidden && document.getElementById('userEditDelWrap').hidden);
}

function closeUserEdit() {
  document.getElementById('userEditBackdrop').hidden = true;
  editingUser = null;
}

document.getElementById('userEditSignOut').addEventListener('click', async () => {
  if (!editingUser) return;
  if (!confirm('Sign ' + (editingUser.fullName || editingUser.email) + ' out of every device? They\'ll need a new emailed code to sign in again.')) return;
  const btn = document.getElementById('userEditSignOut');
  btn.disabled = true;
  const res = await apiPost('signOutEverywhere', { requesterEmail: usersAdminEmail, targetEmail: editingUser.email });
  if (!res.success) { document.getElementById('userEditError').textContent = res.error === 'Unknown action' ? 'Redeploy the Apps Script first.' : (res.error || 'Could not sign them out.'); btn.disabled = false; return; }
  editingUser.signedInDevices = 0;
  document.getElementById('userEditSessionsText').textContent = 'Signed out of ' + res.count + ' device' + (res.count === 1 ? '' : 's') + '.';
  btn.hidden = true;
  const u = adminUsers.filter((x) => sameEmail(x.email, editingUser.email))[0];
  if (u) u.signedInDevices = 0;
});

async function saveUserEdit() {
  if (!editingUser) return;
  const saveBtn = document.getElementById('userEditSave');
  const errEl = document.getElementById('userEditError');
  errEl.textContent = '';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const payload = {
    requesterEmail: usersAdminEmail,
    targetEmail: editingUser.email,
    status: document.getElementById('userEditStatus').value,
    role: document.getElementById('userEditRole').value,
    branch: document.getElementById('userEditBranch').value
  };
  if (payload.role === 'BackOffice') {
    payload.hiddenFinance = Array.from(document.querySelectorAll('#userEditFinCats .perm-cat')).filter((c) => !c.checked).map((c) => c.value);
    const del = document.querySelector('input[name="userEditDel"]:checked');
    payload.manageDeliveries = !!del && del.value === 'manage';
  }
  const res = await apiPost('updateUser', payload);

  if (!res.success) {
    errEl.textContent = res.error === 'Unknown action'
      ? 'Editing needs the updated Apps Script. Redeploy it (Manage deployments → Edit → New version), then try again.'
      : (res.error || 'Could not save.');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save changes';
    return;
  }
  closeUserEdit();
  if (res.warning) alert(res.warning);
  loadAdminView(usersAdminEmail);
}

// ── Small helpers ────────────────────────────────────────────────────

function sameEmail(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// Google Sheets turns typed phone numbers like 0721234567 into the number
// 721234567, dropping the leading zero — put it back for display.
function formatContact(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (/^\d{9}$/.test(s)) return '0' + s;
  return s;
}

// Date on one line, time underneath in grey — keeps the table narrow
// enough to fit a laptop screen without sideways scrolling.
function dateCell(value) {
  const full = formatShortDateTime(value);
  if (!full) return '—';
  const i = full.indexOf(' ');
  if (i === -1) return escapeHtml(full);
  return escapeHtml(full.slice(0, i)) + '<span class="cell-time">' + escapeHtml(full.slice(i + 1)) + '</span>';
}

function formatShortDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ─────────────────────────────────────────────────────────────────────
// BACK OFFICE VIEW
// ─────────────────────────────────────────────────────────────────────

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

async function loadBackOfficeView(user) {
  const expSection = document.getElementById('boExpensesSection');
  expSection.hidden = !featureOn('shopExpenses');
  if (!expSection.hidden) loadExpenseSubmissions(document.getElementById('boExpenseList'), user.email, user.branch);
  const result = await apiGet('recentSubmissions', { email: user.email, branch: user.branch });
  const listEl = document.getElementById('recentList');
  listEl.innerHTML = '';
  if (!result.success) { listEl.innerHTML = '<p class="error-text">' + result.error + '</p>'; return; }
  result.submissions.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'recent-row';
    div.innerHTML =
      '<span>' + escapeHtml(s.branch) + ' — ' + formatDateTime(s.timestamp) + '</span>' +
      '<span>' + fileButton(s.pdfFile, 'PDF') + '</span>';
    listEl.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────────────────
// DELIVERIES & COLLECTIONS (Pro feature "deliveries") — stage 1
// What each person can see and do is decided by the server; the page just
// shows the jobs and the actions it's given.
// ─────────────────────────────────────────────────────────────────────

const JOB_STATUS_CLASS = {
  'Pending Approval': 'js-pending', 'Approved': 'js-approved', 'Scheduled': 'js-scheduled',
  'In Progress': 'js-progress', 'Completed': 'js-done', 'Failed Attempt': 'js-failed',
  'On Hold': 'js-hold', 'Cancelled': 'js-cancelled',
  'Awaiting Dispatch': 'js-awaiting', 'Dispatched': 'js-progress', 'Awaiting Receipt': 'js-scheduled',
  'Discrepancy Reported': 'js-failed'
};
const JOB_FINAL = ['Completed', 'Cancelled'];
let jobsData = null;        // last 'jobs' response
let jobsUiBound = false;
let openJobRef = null;
let openJobData = null;     // last 'job' response
let newJobType = 'Delivery';
let jobProofImage = '';     // compressed photo of the signed delivery note
const PROOF_MAX_DIMENSION = 1800; // a bit sharper than receipts so signatures stay readable
const PROOF_JPEG_QUALITY = 0.78;
let newJobRequestId = '';

function jobStatusTag(status) {
  return '<span class="status-tag job-status ' + (JOB_STATUS_CLASS[status] || 'js-hold') + '">' + escapeHtml(status) + '</span>';
}
function overdueTag(job) { return job.overdue ? ' <span class="status-tag js-overdue">Overdue</span>' : ''; }
function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayTag(job) {
  const day = job.type === 'Transfer' ? (job.status === 'Dispatched' ? job.dispatchDate : '') : job.scheduledDate;
  return day === localToday() && JOB_FINAL.indexOf(job.status) === -1 ? ' <span class="status-tag js-today">Today</span>' : '';
}
function dayLabel(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const p = String(yyyyMmDd).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(yyyyMmDd);
}
function makeRequestId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* older browsers */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function bindJobsUi() {
  if (jobsUiBound) return;
  jobsUiBound = true;
  ['jobsSearch', 'jobsStatus', 'jobsType', 'jobsBranch'].forEach((id) =>
    document.getElementById(id).addEventListener(id === 'jobsSearch' ? 'input' : 'change', renderJobs));
  document.getElementById('jobsList').addEventListener('click', (e) => {
    const card = e.target.closest('.job-card');
    if (card) openJob(card.dataset.ref);
  });
  document.getElementById('newJobBtn').addEventListener('click', openNewJob);
  document.getElementById('ibtAddLine').addEventListener('click', addIbtLine);
  document.getElementById('jobNewClose').addEventListener('click', closeNewJob);
  document.getElementById('jobNewCancel').addEventListener('click', closeNewJob);
  document.getElementById('jobNewSubmit').addEventListener('click', submitNewJob);
  document.querySelectorAll('#jobNewBackdrop .seg button').forEach((b) => b.addEventListener('click', () => setNewJobType(b.dataset.type)));
  document.getElementById('jobClose').addEventListener('click', closeJob);
  // The new-request form only closes with X or Cancel. The job detail closes
  // on an outside click or Esc only while no action form (with typed notes,
  // quantities or a photo) is open.
  guardModalBackdrop('jobNewBackdrop');
  document.getElementById('jobBackdrop').addEventListener('click', (e) => {
    if (e.target.id !== 'jobBackdrop') return;
    if (document.querySelector('#jobBody .jd-form')) nudgeModal('jobBackdrop'); else closeJob();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('jobBackdrop').hidden && !document.querySelector('#jobBody .jd-form')) closeJob();
  });
  document.getElementById('jobBody').addEventListener('click', onJobBodyClick);
  // Receiving a transfer: warn live about lines that will be flagged.
  const updateIssueHint = () => {
    const hint = document.getElementById('jaIssues');
    if (!hint) return;
    let n = 0;
    document.querySelectorAll('#jobBody .ibt-receive-line').forEach((l) => {
      const q = Number(l.querySelector('.ja-qty').value);
      const off = q !== Number(l.dataset.sent) || l.querySelector('.ja-cond').value === 'Damaged';
      l.classList.toggle('has-issue', off);
      if (off) n++;
    });
    hint.hidden = !n;
    hint.textContent = n + ' item line' + (n === 1 ? '' : 's') + ' will be reported as a discrepancy for Head Office to resolve.';
  };
  document.getElementById('jobBody').addEventListener('input', updateIssueHint);
  document.getElementById('jobBody').addEventListener('change', updateIssueHint);
  document.getElementById('jobBody').addEventListener('change', async (e) => {
    if (e.target.id !== 'jaProof') return;
    const file = e.target.files && e.target.files[0];
    const errEl = document.getElementById('jaProofError');
    errEl.textContent = '';
    jobProofImage = '';
    document.getElementById('jaProofWrap').hidden = true;
    if (!file) return;
    if (!file.type.startsWith('image/')) { errEl.textContent = 'Please choose a photo.'; e.target.value = ''; return; }
    try {
      jobProofImage = await resizeImageFileToDataUrl(file, PROOF_MAX_DIMENSION, PROOF_JPEG_QUALITY);
      document.getElementById('jaProofPreview').src = jobProofImage;
      document.getElementById('jaProofWrap').hidden = false;
    } catch (err) {
      errEl.textContent = err.message || 'Could not use that photo. Please take it again.';
    }
  });
  document.getElementById('jobNewBackdrop').addEventListener('input', () => { document.getElementById('jobNewError').textContent = ''; });
}

async function loadJobs() {
  bindJobsUi();
  document.getElementById('jobsLoading').hidden = !!jobsData ? true : false;
  document.getElementById('jobsError').hidden = true;
  const res = await apiGet('jobs', { email: currentUser.email });
  document.getElementById('jobsLoading').hidden = true;
  if (!res.success) {
    const err = document.getElementById('jobsError');
    err.textContent = res.error === 'Unknown action'
      ? 'Deliveries needs the updated Apps Script. Redeploy it (Manage deployments → Edit → New version), then refresh.'
      : (res.error || 'Could not load jobs.');
    err.hidden = false;
    return;
  }
  jobsData = res;
  const intro = {
    Manager: 'Deliveries, collections and stock transfers for ' + res.myBranch + '. New requests go to Head Office for approval; transfers to or from your branch need you to confirm dispatch or receipt.',
    Driver: 'Your jobs. Open one to start it, mark it completed with a photo of the signed delivery note, record that it couldn\'t be done, or mark a transfer as delivered.',
    BackOffice: res.isOffice ? null : 'All deliveries, collections and transfers across branches (view only).'
  }[res.role] || 'All deliveries, collections and transfers across branches. Open a job to approve it, schedule a driver, resolve a transfer discrepancy, put it on hold or cancel it.';
  document.getElementById('jobsIntro').textContent = intro;
  document.getElementById('newJobBtn').hidden = !res.canCreate || !document.getElementById('jobsDashPanel').hidden;
  bindJobsDashboard();
  updateJobsTabs();

  const branchWrap = document.getElementById('jobsBranchWrap');
  branchWrap.hidden = !(res.isOffice || res.role === 'BackOffice');
  const branchSel = document.getElementById('jobsBranch');
  const keep = branchSel.value;
  branchSel.innerHTML = '<option value="">All branches</option>' +
    res.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  branchSel.value = keep;
  renderJobs();
}

function renderJobs() {
  if (!jobsData) return;
  const status = document.getElementById('jobsStatus').value;
  const type = document.getElementById('jobsType').value;
  const branch = document.getElementById('jobsBranch').value;
  const q = document.getElementById('jobsSearch').value.trim().toLowerCase();

  const rows = jobsData.jobs.filter((j) => {
    if (status === 'open' && JOB_FINAL.indexOf(j.status) !== -1) return false;
    if (status === 'overdue' && !j.overdue) return false;
    if (['open', 'overdue', 'all'].indexOf(status) === -1 && j.status !== status) return false;
    if (type && j.type !== type) return false;
    if (branch && j.branch !== branch && j.receivingBranch !== branch) return false;
    if (q) {
      const hay = [j.ref, j.customerName, j.customerContact, j.address, j.itemCategory, j.itemDescription, j.branch,
        j.receivingBranch, j.reason, j.driverName, j.responsiblePerson].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  // Open jobs: soonest required date first. Finished jobs: newest first.
  rows.sort((a, b) => {
    const af = JOB_FINAL.indexOf(a.status) !== -1, bf = JOB_FINAL.indexOf(b.status) !== -1;
    if (af !== bf) return af ? 1 : -1;
    if (!af) {
      const key = (j) => (jobsData.role === 'Driver' ? (j.scheduledDate || j.dispatchDate) : '') || j.requiredDate || '9';
      return key(a).localeCompare(key(b)) || a.ref.localeCompare(b.ref);
    }
    return b.ref.localeCompare(a.ref);
  });

  document.getElementById('jobsList').innerHTML = rows.map((j) =>
    '<button type="button" class="job-card' + (j.overdue ? ' is-overdue' : '') + '" data-ref="' + escapeAttr(j.ref) + '">' +
      '<span class="job-card-top"><span class="job-ref">' + escapeHtml(j.ref) + '</span>' +
        '<span class="type-tag type-' + escapeAttr(j.type.toLowerCase()) + '">' + escapeHtml(j.type) + '</span>' +
        jobStatusTag(j.status) + overdueTag(j) + todayTag(j) + '</span>' +
      (j.type === 'Transfer'
        ? '<span class="job-card-main"><strong>' + escapeHtml(j.branch) + ' → ' + escapeHtml(j.receivingBranch) + '</strong> · ' +
            escapeHtml(j.itemDescription) + '</span>' +
          '<span class="job-card-meta">Requested for ' + escapeHtml(dayLabel(j.requiredDate)) +
            (j.dispatchDate ? ' · Dispatched ' + escapeHtml(dayLabel(j.dispatchDate)) + ' with ' + escapeHtml(j.driverName || j.responsiblePerson) : '') +
          '</span>'
        : '<span class="job-card-main"><strong>' + escapeHtml(j.customerName) + '</strong> · ' +
            escapeHtml(j.itemCategory) + ' — ' + escapeHtml(j.itemDescription) + '</span>' +
          '<span class="job-card-meta">' + escapeHtml(j.branch) + ' · Required ' + escapeHtml(dayLabel(j.requiredDate)) +
            (j.driverName ? ' · ' + escapeHtml(j.driverName) + (j.scheduledDate ? ' on ' + escapeHtml(dayLabel(j.scheduledDate)) : '') : '') +
          '</span>') +
    '</button>'
  ).join('');

  const total = jobsData.jobs.length;
  document.getElementById('jobsCount').textContent = rows.length === total
    ? total + ' job' + (total === 1 ? '' : 's') : 'Showing ' + rows.length + ' of ' + total;
  document.getElementById('jobsEmpty').hidden = rows.length !== 0;
}

// ── New request ──────────────────────────────────────────────────────

function setNewJobType(type) {
  newJobType = type;
  document.querySelectorAll('#jobNewBackdrop .seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.type === type);
    b.setAttribute('aria-checked', b.dataset.type === type ? 'true' : 'false');
  });
  const isTransfer = type === 'Transfer';
  document.getElementById('jobTypeHint').textContent = {
    Delivery: 'Taking an item bought in-store to the customer\'s address.',
    Collection: 'Collecting items a customer wants to donate.',
    Transfer: 'Moving stock from one branch to another (inter-branch transfer).'
  }[type];
  document.getElementById('jobNewTitle').textContent = isTransfer ? 'New inter-branch transfer' : 'New ' + type.toLowerCase() + ' request';
  document.getElementById('jobCustomerSection').hidden = isTransfer;
  document.getElementById('jobInstructionsWrap').hidden = isTransfer;
  document.getElementById('jobTransferSection').hidden = !isTransfer;
  document.getElementById('jobBranchWrap').hidden = isTransfer || (jobsData && jobsData.role === 'Manager');
  document.getElementById('jobDateLabel').textContent = isTransfer ? 'Requested transfer date' : 'Required date';
  if (isTransfer && !document.querySelector('#ibtLines .ibt-line')) addIbtLine();
}

function ibtBranchOptions(selected) {
  return '<option value="">Choose…</option>' + jobsData.branches.map((b) =>
    '<option value="' + escapeAttr(b) + '"' + (b === selected ? ' selected' : '') + '>' + escapeHtml(b) + '</option>').join('');
}

function addIbtLine() {
  const wrap = document.getElementById('ibtLines');
  if (wrap.children.length >= 20) { document.getElementById('jobNewError').textContent = 'A transfer can have at most 20 item lines.'; return; }
  const div = document.createElement('div');
  div.className = 'ibt-line';
  div.innerHTML =
    '<select class="ibt-cat" aria-label="Category"><option value="">Category…</option>' +
      jobsData.categories.map((c) => '<option>' + escapeHtml(c) + '</option>').join('') + '</select>' +
    '<input type="text" class="ibt-desc" placeholder="Description, e.g. Winter jackets" aria-label="Description" maxlength="200">' +
    '<input type="number" class="ibt-qty" min="1" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity">' +
    '<button type="button" class="row-remove ibt-remove" aria-label="Remove item">✕</button>';
  div.querySelector('.ibt-remove').addEventListener('click', () => { div.remove(); if (!wrap.children.length) addIbtLine(); });
  wrap.appendChild(div);
}

function openNewJob() {
  if (!jobsData) return;
  newJobRequestId = makeRequestId(); // a retry of this same form never creates a second job
  ['jobCustName', 'jobCustContact', 'jobAddress', 'jobItemDesc', 'jobInstructions', 'jobRequiredDate', 'ibtReason'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('ibtLines').innerHTML = '';
  // A Store Manager's own branch is pre-filled as the receiving branch (they
  // can swap it to sending); one of the two must be their branch.
  const mine = jobsData.role === 'Manager' ? jobsData.myBranch : '';
  document.getElementById('ibtFrom').innerHTML = ibtBranchOptions('');
  document.getElementById('ibtTo').innerHTML = ibtBranchOptions(mine);
  document.getElementById('jobCategory').innerHTML = '<option value="">Choose…</option>' +
    jobsData.categories.map((c) => '<option>' + escapeHtml(c) + '</option>').join('');
  const branchWrap = document.getElementById('jobBranchWrap');
  const branchSel = document.getElementById('jobBranch');
  if (jobsData.role === 'Manager') {
    branchWrap.hidden = true;
  } else {
    branchWrap.hidden = false;
    branchSel.innerHTML = '<option value="">Choose…</option>' +
      jobsData.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  }
  document.getElementById('jobRequiredDate').min = new Date().toISOString().slice(0, 10);
  setNewJobType('Delivery');
  document.getElementById('jobNewError').textContent = '';
  const btn = document.getElementById('jobNewSubmit');
  btn.disabled = false; btn.textContent = 'Submit for approval';
  document.getElementById('jobNewBackdrop').hidden = false;
  document.getElementById('jobCustName').focus();
}

function closeNewJob() { document.getElementById('jobNewBackdrop').hidden = true; }

async function submitNewJob() {
  const errEl = document.getElementById('jobNewError');
  const v = (id) => document.getElementById(id).value.trim();
  if (newJobType === 'Transfer') return submitNewTransfer();
  const payload = {
    requesterEmail: currentUser.email, type: newJobType, clientRequestId: newJobRequestId,
    branch: v('jobBranch'), customerName: v('jobCustName'), customerContact: v('jobCustContact'), address: v('jobAddress'),
    itemCategory: v('jobCategory'), itemDescription: v('jobItemDesc'), requiredDate: v('jobRequiredDate'), instructions: v('jobInstructions')
  };
  errEl.textContent = '';
  if (jobsData.role !== 'Manager' && !payload.branch) { errEl.textContent = 'Choose the branch.'; return; }
  if (!payload.customerName || !payload.customerContact || !payload.address) { errEl.textContent = 'Customer name, contact number and address are required.'; return; }
  if (!payload.itemCategory || !payload.itemDescription) { errEl.textContent = 'Choose a category and describe the item.'; return; }
  if (!payload.requiredDate) { errEl.textContent = 'Choose the required date.'; return; }

  const btn = document.getElementById('jobNewSubmit');
  btn.disabled = true; btn.textContent = 'Submitting…';
  const res = await apiPost('createJob', payload);
  btn.disabled = false; btn.textContent = 'Submit for approval';
  if (!res.success) {
    errEl.textContent = res.networkError
      ? 'Lost connection — it may have gone through. Press Submit again: it won\'t create a duplicate.'
      : (res.error || 'Could not submit.');
    return;
  }
  closeNewJob();
  showJobsNotice(res.ref + ' was sent to Head Office for approval.' + (res.warning ? ' Note: ' + res.warning : ''));
  document.getElementById('jobsStatus').value = 'open';
  await loadJobs();
}

async function submitNewTransfer() {
  const errEl = document.getElementById('jobNewError');
  const v = (id) => document.getElementById(id).value.trim();
  const payload = {
    requesterEmail: currentUser.email, type: 'Transfer', clientRequestId: newJobRequestId,
    sendingBranch: v('ibtFrom'), receivingBranch: v('ibtTo'), reason: v('ibtReason'), requiredDate: v('jobRequiredDate'), items: []
  };
  errEl.textContent = '';
  if (!payload.sendingBranch || !payload.receivingBranch) { errEl.textContent = 'Choose the sending and receiving branches.'; return; }
  if (payload.sendingBranch === payload.receivingBranch) { errEl.textContent = 'The two branches must be different.'; return; }
  if (jobsData.role === 'Manager' && payload.sendingBranch !== jobsData.myBranch && payload.receivingBranch !== jobsData.myBranch) {
    errEl.textContent = 'One of the branches must be your own (' + jobsData.myBranch + ').'; return;
  }
  if (!payload.reason) { errEl.textContent = 'Give a reason for the transfer.'; return; }
  const lines = document.querySelectorAll('#ibtLines .ibt-line');
  for (let i = 0; i < lines.length; i++) {
    const cat = lines[i].querySelector('.ibt-cat').value;
    const desc = lines[i].querySelector('.ibt-desc').value.trim();
    const qty = Number(lines[i].querySelector('.ibt-qty').value);
    if (!cat && !desc && !qty) continue;
    if (!cat || !desc || !Number.isInteger(qty) || qty < 1) { errEl.textContent = 'Item ' + (i + 1) + ' needs a category, a description and a whole-number quantity.'; return; }
    payload.items.push({ category: cat, description: desc, qty: qty });
  }
  if (!payload.items.length) { errEl.textContent = 'Add at least one item.'; return; }
  if (!payload.requiredDate) { errEl.textContent = 'Choose the requested transfer date.'; return; }

  const btn = document.getElementById('jobNewSubmit');
  btn.disabled = true; btn.textContent = 'Submitting…';
  const res = await apiPost('createJob', payload);
  btn.disabled = false; btn.textContent = 'Submit for approval';
  if (!res.success) {
    errEl.textContent = res.networkError
      ? 'Lost connection — it may have gone through. Press Submit again: it won\'t create a duplicate.'
      : (res.error || 'Could not submit.');
    return;
  }
  closeNewJob();
  showJobsNotice(res.ref + ' was sent to Head Office for approval.' + (res.warning ? ' Note: ' + res.warning : ''));
  document.getElementById('jobsStatus').value = 'open';
  await loadJobs();
}

function showJobsNotice(text) {
  const el = document.getElementById('jobsNotice');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(showJobsNotice._t);
  showJobsNotice._t = setTimeout(() => { el.hidden = true; }, 9000);
}

// ── Job detail ───────────────────────────────────────────────────────

async function openJob(ref) {
  bindJobsUi();
  openJobRef = ref;
  openJobData = null;
  document.getElementById('jobTitle').textContent = ref;
  document.getElementById('jobSubtitle').textContent = '';
  document.getElementById('jobBody').innerHTML = '<p class="muted">Loading…</p>';
  document.getElementById('jobBackdrop').hidden = false;
  const res = await apiGet('job', { email: currentUser.email, ref: ref });
  if (openJobRef !== ref) return;
  if (!res.success) {
    document.getElementById('jobBody').innerHTML = '<p class="error-text">' + escapeHtml(res.error || 'Could not load this job.') + '</p>';
    return;
  }
  openJobData = res;
  renderJob();
  markBellRead({ ref: ref });
}

function closeJob() {
  document.getElementById('jobBackdrop').hidden = true;
  openJobRef = null;
  openJobData = null;
}

function renderJob(activeAction) {
  const j = openJobData.job;
  const isTransfer = j.type === 'Transfer';
  document.getElementById('jobTitle').textContent = j.ref + ' · ' + (isTransfer ? 'Inter-branch transfer' : j.type);
  document.getElementById('jobSubtitle').textContent = (isTransfer ? j.branch + ' → ' + j.receivingBranch : j.branch) +
    ' · logged ' + formatShortDateTime(j.createdAt);
  const row = (label, value, html) => value ? '<div class="jd-row"><span>' + label + '</span><span>' + (html ? value : escapeHtml(value)) + '</span></div>' : '';
  const tel = String(j.customerContact || '').replace(/[^\d+]/g, '');

  let actionsHtml = '';
  if (openJobData.actions.length) {
    actionsHtml = '<div class="jd-actions">' + openJobData.actions.map((a) =>
      '<button type="button" class="jd-action-btn' + (a.key === 'cancel' || a.key === 'fail' ? ' is-danger' : '') +
      (a.key === 'complete' || a.key === 'receive' || a.key === 'dispatch' ? ' is-go' : '') + (activeAction === a.key ? ' active' : '') +
      '" data-action="' + a.key + '">' + escapeHtml(a.label) + '</button>').join('') + '</div>';
    if (activeAction) actionsHtml += jobActionForm(activeAction, j);
  }
  if (activeAction === 'value') {
    actionsHtml += '<div class="jd-form"><label>Estimated value of the donated items (R)' +
      ' <input type="text" inputmode="decimal" id="jaValue" value="' + (j.collectionValue === null ? '' : escapeAttr(j.collectionValue.toFixed(2))) + '" placeholder="e.g. 850"></label>' +
      '<p class="muted" style="font-size:13px;margin-top:-4px;">A rough figure is fine — it adds up the donated stock collected on the dashboard. Leave empty to remove it.</p>' +
      '<div class="user-edit-actions"><button type="button" class="btn-secondary" data-form="back">Back</button>' +
      '<button type="button" class="btn-primary" data-value-save>Save value</button></div></div>';
  }

  const history = openJobData.history.slice().reverse().map((h) =>
    '<li><span class="jh-when">' + escapeHtml(formatShortDateTime(h.timestamp)) + '</span>' +
    '<span class="jh-what">' + (h.fromStatus ? escapeHtml(h.fromStatus) + ' → ' : '') + '<strong>' + escapeHtml(h.toStatus) + '</strong>' +
    (h.notes ? '<span class="jh-notes">' + escapeHtml(h.notes) + '</span>' : '') + '</span>' +
    '<span class="jh-by muted">' + escapeHtml(h.by) + '</span></li>').join('');

  document.getElementById('jobBody').innerHTML =
    '<div class="jd-status">' + jobStatusTag(j.status) + overdueTag(j) + todayTag(j) + '</div>' +
    (isTransfer ? transferDetailHtml(j, row) : '<div class="jd-grid">' +
      row('Customer', j.customerName) +
      row('Contact', tel ? '<a href="tel:' + escapeAttr(tel) + '">' + escapeHtml(j.customerContact) + '</a>' : '', true) +
      row('Address', escapeHtml(j.address) + ' <a class="maps-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent(j.address) + '">Open in Maps</a>', true) +
      row('Item', j.itemCategory + ' — ' + j.itemDescription) +
      row('Required by', dayLabel(j.requiredDate)) +
      row('Instructions', j.instructions) +
      row('Driver', j.driverName ? j.driverName + (j.scheduledDate ? ' · ' + dayLabel(j.scheduledDate) : '') : '') +
      row('Approved by', j.approvedBy ? j.approvedBy + ' · ' + formatShortDateTime(j.approvedAt) : '') +
      row('Logged by', j.createdBy) +
      row('Completed', j.completedAt ? (openJobData.completedByName || j.completedBy) + ' · ' + formatShortDateTime(j.completedAt) : '') +
      row('Proof', j.proofFile ? fileButton(j.proofFile, 'View signed delivery note') : '', true) +
      row('Driver\'s note', j.completionNotes) +
      ('collectionValue' in j ? row('Estimated value', (j.collectionValue === null ? '<span class="muted">Not recorded</span>' : escapeHtml(rand(j.collectionValue))) +
        (openJobData.canSetValue && activeAction !== 'value' ? ' <button type="button" class="link-btn" data-value-edit>' + (j.collectionValue === null ? 'Add' : 'Edit') + '</button>' : ''), true) : '') +
      row('Last failed attempt', j.status !== 'Completed' ? j.lastFailReason : '') +
    '</div>') +
    actionsHtml +
    '<p class="error-text" id="jobActionError"></p>' +
    '<h3 class="form-sub">History</h3><ul class="job-history">' + history + '</ul>';
}

function transferDetailHtml(j, row) {
  const items = openJobData.items || [];
  const showSent = items.some((x) => x.qtyDispatched !== null);
  const showGot = items.some((x) => x.qtyReceived !== null);
  const table = '<div class="ibt-table-wrap"><table class="ibt-table"><thead><tr><th>#</th><th>Item</th><th>Requested</th>' +
    (showSent ? '<th>Sent</th>' : '') + (showGot ? '<th>Received</th><th>Condition</th>' : '') + '</tr></thead><tbody>' +
    items.map((x) =>
      '<tr' + (x.discrepancy ? ' class="has-issue"' : '') + '><td>' + x.line + '</td>' +
      '<td><strong>' + escapeHtml(x.description) + '</strong><span class="muted ibt-cat-label">' + escapeHtml(x.category) + '</span>' +
        (x.discrepancy ? '<span class="ibt-issue">' + escapeHtml(x.discrepancy) + (x.notes ? ' — ' + escapeHtml(x.notes) : '') + '</span>' : '') + '</td>' +
      '<td>' + x.qtyRequested + '</td>' +
      (showSent ? '<td>' + (x.qtyDispatched === null ? '—' : x.qtyDispatched) + '</td>' : '') +
      (showGot ? '<td>' + (x.qtyReceived === null ? '—' : x.qtyReceived) + '</td><td>' + escapeHtml(x.condition || '—') + '</td>' : '') +
      '</tr>').join('') +
    '</tbody></table></div>';
  return '<div class="jd-grid">' +
      row('From', j.branch) +
      row('To', j.receivingBranch) +
      row('Requested for', dayLabel(j.requiredDate)) +
      row('Reason', j.reason) +
      row('Approved by', j.approvedBy ? j.approvedBy + ' · ' + formatShortDateTime(j.approvedAt) : '') +
      row('Dispatched', j.dispatchDate ? dayLabel(j.dispatchDate) + ' · ' + (j.driverName ? j.driverName + ' (driver)' : j.responsiblePerson) +
        ' · confirmed by ' + j.dispatchedBy : '') +
      row('Received', j.receivedAt ? 'Confirmed by ' + j.receivedBy + ' · ' + formatShortDateTime(j.receivedAt) : '') +
      row('Resolution', j.resolutionNotes) +
      row('Requested by', j.createdBy) +
    '</div>' + table;
}

function jobActionForm(key, j) {
  const notes = (label, required) => '<label>' + label + (required ? '' : ' (optional)') +
    ' <textarea id="jaNotes" rows="2"></textarea></label>';
  let body = '';
  let confirm = 'Confirm';
  const items = openJobData.items || [];
  if (key === 'dispatch') {
    const drivers = openJobData.drivers || [];
    body = '<p class="muted">Enter what is actually being sent (0 if an item isn\'t going).</p>' +
      '<div class="ibt-form-lines">' + items.map((x) =>
        '<label class="ibt-form-line"><span>' + escapeHtml(x.description) + ' <span class="muted">(requested ' + x.qtyRequested + ')</span></span>' +
        '<input type="number" min="0" step="1" inputmode="numeric" class="ja-qty" data-line="' + x.line + '" value="' + x.qtyRequested + '"></label>').join('') +
      '</div>' +
      '<div class="grid-2"><label>Dispatch date <input type="date" id="jaDate" value="' + localToday() + '"></label>' +
      '<label>Driver <select id="jaDriver"><option value="">No driver — branch staff taking it</option>' +
        drivers.map((d) => '<option value="' + escapeAttr(d.email) + '">' + escapeHtml(d.fullName) + '</option>').join('') + '</select></label></div>' +
      '<label>Responsible person <input type="text" id="jaPerson" value="' + escapeAttr(currentUser.fullName || '') + '" maxlength="120"></label>' +
      notes('Note', false);
    confirm = 'Confirm dispatch';
  } else if (key === 'deliver') {
    body = '<p class="muted">Confirm the items have been dropped off at ' + escapeHtml(j.receivingBranch) + '. The branch will then check and confirm what arrived.</p>';
    confirm = 'Mark delivered';
  } else if (key === 'receive') {
    body = '<p class="muted">Count what actually arrived and note its condition. Any difference from what was sent is flagged for Head Office.</p>' +
      '<div class="ibt-form-lines">' + items.map((x) => {
        const sent = x.qtyDispatched === null ? x.qtyRequested : x.qtyDispatched;
        return '<div class="ibt-form-line ibt-receive-line" data-line="' + x.line + '" data-sent="' + sent + '">' +
          '<span>' + escapeHtml(x.description) + ' <span class="muted">(sent ' + sent + ')</span></span>' +
          '<div class="ibt-receive-inputs">' +
            '<input type="number" min="0" step="1" inputmode="numeric" class="ja-qty" aria-label="Quantity received" value="' + sent + '">' +
            '<select class="ja-cond" aria-label="Condition">' + (openJobData.conditions || ['Good', 'Damaged']).map((c) => '<option>' + escapeHtml(c) + '</option>').join('') + '</select>' +
          '</div>' +
          '<input type="text" class="ja-line-note" placeholder="Note (if something\'s wrong)" maxlength="300" aria-label="Note">' +
        '</div>';
      }).join('') + '</div>' +
      '<p class="ibt-warning" id="jaIssues" hidden></p>' +
      notes('Note', false);
    confirm = 'Confirm receipt';
  } else if (key === 'resolve') {
    body = '<p class="muted">Record how the discrepancy was sorted out (e.g. missing items found, damaged stock written off). This completes the transfer.</p>' +
      notes('How was it resolved?', true);
    confirm = 'Resolve and complete';
  } else if (key === 'start') {
    body = '<p class="muted">Lets the branch know you\'re on your way.</p>';
    confirm = 'Start job';
  } else if (key === 'complete') {
    body = '<label>Photo of the ' + (j.type === 'Collection' ? 'collection slip' : 'delivery note') + ', signed by the customer' +
      ' <input type="file" id="jaProof" accept="image/*" capture="environment"></label>' +
      '<div id="jaProofWrap" class="exp-preview-wrap" hidden><img id="jaProofPreview" class="exp-preview" alt="Proof photo preview"></div>' +
      '<p class="error-text" id="jaProofError"></p>' +
      (openJobData.valueOn ? '<label>Estimated value of the donated items (R, optional) <input type="text" inputmode="decimal" id="jaValue" placeholder="e.g. 850"></label>' : '') +
      notes('Note, e.g. who received it', false);
    confirm = 'Mark completed';
  } else if (key === 'fail') {
    body = '<label>What went wrong? <select id="jaReason"><option value="">Choose…</option>' +
      (openJobData.failReasons || []).map((r) => '<option>' + escapeHtml(r) + '</option>').join('') + '</select></label>' +
      '<p class="muted" style="font-size:13px;margin-top:-4px;">The job stays open so Head Office can reschedule it.</p>' +
      notes('Details', false);
    confirm = 'Record failed attempt';
  } else if (key === 'approve') {
    body = '<p class="muted">Approve this ' + j.type.toLowerCase() + ' so it can be scheduled with a driver.</p>' + notes('Note', false);
    confirm = 'Approve';
  } else if (key === 'schedule') {
    const drivers = openJobData.drivers || [];
    if (!drivers.length) {
      return '<div class="jd-form"><p class="muted">There are no drivers yet. Approve someone with the <strong>Driver</strong> role under Approvals first.</p></div>';
    }
    body = '<div class="grid-2"><label>Driver <select id="jaDriver"><option value="">Choose…</option>' +
      drivers.map((d) => '<option value="' + escapeAttr(d.email) + '"' + (d.email === String(j.driverEmail).toLowerCase() ? ' selected' : '') + '>' +
        escapeHtml(d.fullName) + '</option>').join('') + '</select></label>' +
      '<label>Date <input type="date" id="jaDate" value="' + escapeAttr(j.scheduledDate || j.requiredDate || '') + '"></label></div>' +
      notes('Note for the record', false);
    confirm = j.status === 'Approved' ? 'Schedule' : 'Save new schedule';
  } else if (key === 'hold') {
    body = notes('Reason for putting it on hold', true);
    confirm = 'Put on hold';
  } else if (key === 'resume') {
    body = '<p class="muted">Take this job off hold and carry on where it left off.</p>';
    confirm = 'Resume';
  } else if (key === 'cancel') {
    body = '<p class="muted">Cancelled jobs stay in the history but can\'t be reopened.</p>' + notes('Reason for cancelling', true);
    confirm = 'Cancel job';
  }
  return '<div class="jd-form">' + body +
    '<div class="user-edit-actions"><button type="button" class="btn-secondary" data-form="back">Back</button>' +
    '<button type="button" class="btn-primary' + (key === 'cancel' || key === 'fail' ? ' btn-danger' : '') + (key === 'complete' ? ' btn-go' : '') +
    '" data-form="confirm" data-action="' + key + '">' + escapeHtml(confirm) + '</button></div></div>';
}

async function onJobBodyClick(e) {
  if (e.target.closest('[data-value-edit]')) { renderJob('value'); const v = document.getElementById('jaValue'); if (v) v.focus(); return; }
  const saveBtn = e.target.closest('[data-value-save]');
  if (saveBtn) {
    const errEl = document.getElementById('jobActionError');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const res = await apiPost('setCollectionValue', { requesterEmail: currentUser.email, ref: openJobRef, value: document.getElementById('jaValue').value.trim() });
    if (!res.success) { errEl.textContent = res.error || 'Could not save.'; saveBtn.disabled = false; saveBtn.textContent = 'Save value'; return; }
    await openJob(openJobRef);
    loadJobs();
    return;
  }
  const actionBtn = e.target.closest('.jd-action-btn');
  if (actionBtn) {
    jobProofImage = '';
    renderJob(actionBtn.dataset.action);
    const form = document.querySelector('#jobBody .jd-form');
    if (form && form.scrollIntoView) form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  const formBtn = e.target.closest('[data-form]');
  if (!formBtn) return;
  if (formBtn.dataset.form === 'back') { renderJob(); return; }

  const key = formBtn.dataset.action;
  const errEl = document.getElementById('jobActionError');
  const notesEl = document.getElementById('jaNotes');
  const payload = { requesterEmail: currentUser.email, ref: openJobRef, step: key, notes: notesEl ? notesEl.value.trim() : '' };
  if (key === 'dispatch') {
    payload.items = {};
    let total = 0;
    let bad = false;
    document.querySelectorAll('#jobBody .ja-qty').forEach((i) => {
      const q = Number(i.value);
      if (i.value === '' || !Number.isInteger(q) || q < 0) bad = true;
      payload.items[i.dataset.line] = q;
      total += q || 0;
    });
    if (bad) { errEl.textContent = 'Enter a whole-number quantity for every item (0 if it isn\'t going).'; return; }
    if (!total) { errEl.textContent = 'Nothing is being dispatched — enter at least one quantity.'; return; }
    payload.dispatchDate = document.getElementById('jaDate').value;
    payload.driverEmail = document.getElementById('jaDriver').value;
    payload.responsiblePerson = document.getElementById('jaPerson').value.trim();
    if (!payload.dispatchDate) { errEl.textContent = 'Choose the dispatch date.'; return; }
    if (!payload.driverEmail && !payload.responsiblePerson) { errEl.textContent = 'Choose a driver or enter who is taking the items.'; return; }
  }
  if (key === 'receive') {
    payload.items = {};
    let bad = false;
    document.querySelectorAll('#jobBody .ibt-receive-line').forEach((l) => {
      const qEl = l.querySelector('.ja-qty');
      const q = Number(qEl.value);
      if (qEl.value === '' || !Number.isInteger(q) || q < 0) bad = true;
      payload.items[l.dataset.line] = { qty: q, condition: l.querySelector('.ja-cond').value, notes: l.querySelector('.ja-line-note').value.trim() };
    });
    if (bad) { errEl.textContent = 'Enter a whole-number quantity received for every item (0 if none arrived).'; return; }
  }
  if (key === 'resolve' && !payload.notes) { errEl.textContent = 'Please describe how it was resolved.'; return; }
  if (key === 'complete') {
    if (!jobProofImage) { errEl.textContent = 'Add a photo of the signed delivery note.'; return; }
    payload.proofImage = jobProofImage;
    const valEl = document.getElementById('jaValue');
    if (valEl) {
      payload.collectionValue = valEl.value.trim();
      if (payload.collectionValue && !/^R?\s*[\d\s,]*\.?\d*$/i.test(payload.collectionValue)) { errEl.textContent = 'Enter the value as a number, e.g. 850 — or leave it empty.'; return; }
    }
  }
  if (key === 'fail') {
    payload.reason = document.getElementById('jaReason').value;
    if (!payload.reason) { errEl.textContent = 'Choose what went wrong.'; return; }
    if (payload.reason === 'Other' && !payload.notes) { errEl.textContent = 'Please describe what went wrong.'; return; }
  }
  if (key === 'schedule') {
    payload.driverEmail = document.getElementById('jaDriver').value;
    payload.scheduledDate = document.getElementById('jaDate').value;
    if (!payload.driverEmail || !payload.scheduledDate) { errEl.textContent = 'Choose a driver and a date.'; return; }
  }
  if ((key === 'hold' || key === 'cancel') && !payload.notes) { errEl.textContent = 'Please add a reason.'; return; }

  formBtn.disabled = true; formBtn.textContent = key === 'complete' ? 'Uploading photo…' : 'Saving…';
  const res = await apiPost('jobAction', payload);
  if (res.success) jobProofImage = '';
  if (!res.success) {
    errEl.textContent = res.error || 'Could not save.';
    formBtn.disabled = false; formBtn.textContent = 'Try again';
    return;
  }
  const ref = openJobRef;
  await openJob(ref);
  if (res.warning) document.getElementById('jobActionError').textContent = res.warning;
  loadJobs();
}

// ─────────────────────────────────────────────────────────────────────
// DELIVERIES DASHBOARD (stage 4) — Jobs | Dashboard switch on the
// Deliveries tab, action lists, charts, drivers and the monthly report.
// ─────────────────────────────────────────────────────────────────────

const JD_COLORS = { Delivery: '#0d53af', Collection: '#E6007E', Transfer: '#7b61c9' };
const JD_LABELS = { Delivery: 'Deliveries', Collection: 'Collections', Transfer: 'Transfers' };
function jdCount(n, type) { return n + ' ' + (n === 1 ? type : JD_LABELS[type]).toLowerCase(); }
let jdBound = false;
let jdData = null;
let jdLoadSeq = 0;
const jdCharts = {};

function jobsTab(which) {
  document.querySelectorAll('#jobsTabs [data-jobs-tab]').forEach((b) => b.classList.toggle('active', b.dataset.jobsTab === which));
  document.getElementById('jobsListPanel').hidden = which !== 'list';
  document.getElementById('jobsDashPanel').hidden = which !== 'dash';
  document.getElementById('newJobBtn').hidden = which !== 'list' || !(jobsData && jobsData.canCreate);
  if (which === 'dash') loadJobsDashboard();
}

// Same rules as the server's "Needs attention" list, for the tab badge.
function jobsAttentionCount() {
  if (!jobsData) return 0;
  const today = localToday();
  return jobsData.jobs.filter((j) => {
    if (JOB_FINAL.indexOf(j.status) !== -1) return false;
    if (j.overdue || ['Failed Attempt', 'Discrepancy Reported', 'On Hold'].indexOf(j.status) !== -1) return true;
    if (j.status === 'Pending Approval') {
      const d = new Date(j.createdAt);
      return !isNaN(d) && (Date.parse(today) - Date.parse(localDay(d))) >= 86400000;
    }
    return false;
  }).length;
}
function localDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function updateJobsTabs() {
  const tabs = document.getElementById('jobsTabs');
  tabs.hidden = !jobsData || jobsData.role === 'Driver';
  const n = jobsAttentionCount();
  const badge = document.getElementById('jobsAttnBadge');
  badge.hidden = tabs.hidden || !n;
  badge.textContent = n;
  if (!document.getElementById('jobsDashPanel').hidden) loadJobsDashboard();
}

function bindJobsDashboard() {
  if (jdBound) return;
  jdBound = true;
  document.getElementById('jobsTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jobs-tab]');
    if (b) jobsTab(b.dataset.jobsTab);
  });
  ['jdPeriod', 'jdBranch', 'jdType', 'jdFrom', 'jdTo'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
    const custom = document.getElementById('jdPeriod').value === 'custom';
    document.getElementById('jdFromWrap').hidden = !custom;
    document.getElementById('jdToWrap').hidden = !custom;
    if (custom && (!document.getElementById('jdFrom').value || !document.getElementById('jdTo').value)) return;
    loadJobsDashboard();
  }));
  const open = (e) => { const r = e.target.closest('[data-open-job]'); if (r) openJob(r.dataset.openJob); };
  document.getElementById('jdAttention').addEventListener('click', open);
  document.getElementById('jdTransfers').addEventListener('click', open);
  document.getElementById('jdReportBtn').addEventListener('click', openDeliveriesReport);
  const m = new Date(); m.setDate(1); m.setMonth(m.getMonth() - 1);
  document.getElementById('jdReportMonth').value = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
}

function jdParams() {
  const p = { email: currentUser.email, period: document.getElementById('jdPeriod').value,
    branch: document.getElementById('jdBranch').value, type: document.getElementById('jdType').value };
  if (p.period === 'custom') { p.from = document.getElementById('jdFrom').value; p.to = document.getElementById('jdTo').value; }
  return p;
}

async function loadJobsDashboard() {
  bindJobsDashboard();
  const seq = ++jdLoadSeq;
  const err = document.getElementById('jdError');
  err.hidden = true;
  document.getElementById('jdRange').textContent = 'Loading…';
  const res = await apiGet('deliveriesDashboard', jdParams());
  if (seq !== jdLoadSeq) return;
  if (!res.success) {
    document.getElementById('jdRange').textContent = '';
    err.textContent = res.error === 'Unknown action' ? 'The dashboard needs the updated Apps Script. Redeploy it, then refresh.' : (res.error || 'Could not load the dashboard.');
    err.hidden = false;
    return;
  }
  jdData = res;
  const branchSel = document.getElementById('jdBranch');
  document.getElementById('jdBranchWrap').hidden = !!res.lockedBranch;
  if (!res.lockedBranch && branchSel.options.length < 2) {
    branchSel.innerHTML = '<option value="">All branches</option>' + res.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  }
  renderJobsDashboard(res);
}

function jdRangeLabel(res) {
  const r = res.range;
  return dayLabel(r.from) + ' – ' + dayLabel(r.to) + ' · ' + (res.lockedBranch || res.branch || 'All branches') +
    (res.type ? ' · ' + JD_LABELS[res.type] : '');
}

function jdKpi(label, value, sub, cls) {
  return '<div class="kpi-card' + (cls ? ' ' + cls : '') + '"><span class="kpi-label">' + escapeHtml(label) + '</span>' +
    '<span class="kpi-value">' + escapeHtml(value) + '</span>' + (sub ? '<span class="kpi-sub">' + escapeHtml(sub) + '</span>' : '') + '</div>';
}

function jdKpisHtml(k, valueOn) {
  const parts = [];
  ['Delivery', 'Collection', 'Transfer'].forEach((t) => { if (k.completed[t]) parts.push(jdCount(k.completed[t], t)); });
  let html = jdKpi('Completed', String(k.completedTotal), parts.join(' · ') || 'none in this period') +
    jdKpi('On time', k.onTimePct === null ? '—' : k.onTimePct + '%', k.onTimeOf ? k.onTime + ' of ' + k.onTimeOf + ' by the required date' : 'no completed jobs yet',
      k.onTimePct === null ? '' : (k.onTimePct >= 90 ? 'is-good' : (k.onTimePct >= 70 ? 'is-warn' : 'is-bad'))) +
    jdKpi('Open now', String(k.open), k.overdue ? k.overdue + ' overdue' : 'none overdue', k.overdue ? 'is-bad' : '') +
    jdKpi('Failed attempts', String(k.failedAttempts), k.failedJobs ? k.recovered + ' of ' + k.failedJobs + ' since completed' : 'none in this period', k.failedAttempts ? 'is-warn' : '') +
    jdKpi('Turnaround', k.avgDays === null ? '—' : k.avgDays + ' days', 'average, request to done') +
    jdKpi('New requests', String(k.requested), 'logged in this period');
  if (valueOn) html += jdKpi('Donated stock collected', rand(k.collectionValue || 0), k.valuedCollections + ' collection' + (k.valuedCollections === 1 ? '' : 's') + ' valued');
  return html;
}

function renderJobsDashboard(res) {
  const k = res.kpis;
  document.getElementById('jdRange').textContent = jdRangeLabel(res);
  document.getElementById('jdKpis').innerHTML = jdKpisHtml(k, res.valueOn);

  // Needs attention
  document.getElementById('jdAttnCount').textContent = res.attentionTotal ? '(' + res.attentionTotal + ')' : '';
  document.getElementById('jdAttention').innerHTML = res.attention.length ? res.attention.map((a) =>
    '<button type="button" class="jd-item sev-' + a.severity + '" data-open-job="' + escapeAttr(a.ref) + '">' +
      '<span class="jd-item-top"><strong>' + escapeHtml(a.ref) + '</strong>' +
        '<span class="type-tag type-' + escapeAttr(a.type.toLowerCase()) + '">' + escapeHtml(a.type) + '</span>' +
        '<span class="muted">' + escapeHtml(a.branch + (a.receivingBranch ? ' → ' + a.receivingBranch : '')) + '</span></span>' +
      '<span class="jd-item-issue">' + escapeHtml(a.issue) + '</span>' +
    '</button>').join('') + (res.attentionTotal > res.attention.length ? '<p class="muted">…and ' + (res.attentionTotal - res.attention.length) + ' more.</p>' : '')
    : '<p class="jd-allgood">Nothing needs attention — all on track.</p>';

  // Transfer problems
  document.getElementById('jdTransferCard').hidden = res.type && res.type !== 'Transfer';
  document.getElementById('jdTransfers').innerHTML = res.transferProblems.length ? res.transferProblems.map((t) =>
    '<button type="button" class="jd-item' + (t.status === 'Discrepancy Reported' ? ' sev-2' : '') + '" data-open-job="' + escapeAttr(t.ref) + '">' +
      '<span class="jd-item-top"><strong>' + escapeHtml(t.ref) + '</strong><span class="muted">' + escapeHtml(t.from + ' → ' + t.to) + '</span>' +
        (t.status === 'Discrepancy Reported' ? '<span class="status-tag js-overdue">To resolve</span>' : '<span class="status-tag js-done">Resolved</span>') + '</span>' +
      t.problems.map((p) => '<span class="jd-item-issue">' + escapeHtml(p) + '</span>').join('') +
      (t.resolution ? '<span class="muted jd-item-note">' + escapeHtml(t.resolution) + '</span>' : '') +
    '</button>').join('') : '<p class="jd-allgood">No transfer problems in this period.</p>';

  // Charts
  const types = res.type ? [res.type] : ['Delivery', 'Collection', 'Transfer'];
  document.getElementById('jdTrendUnit').textContent = '(per ' + res.trend.unit + ')';
  jdBarChart('trend', 'jdChartTrend', res.trend.labels, types.map((t) => ({ label: JD_LABELS[t], data: res.trend.series[t], backgroundColor: JD_COLORS[t] })), { stacked: true });
  document.getElementById('jdBranchCard').hidden = !!res.lockedBranch || !!res.branch;
  if (!res.lockedBranch && !res.branch) {
    jdBarChart('branch', 'jdChartBranch', res.byBranch.map((b) => b.branch),
      types.map((t) => ({ label: JD_LABELS[t], data: res.byBranch.map((b) => b[t]), backgroundColor: JD_COLORS[t] })), { stacked: true, horizontal: true });
  }
  const catTypes = types.filter((t) => t !== 'Transfer');
  jdBarChart('category', 'jdChartCategory', res.byCategory.map((c) => c.category),
    catTypes.map((t) => ({ label: JD_LABELS[t], data: res.byCategory.map((c) => c[t]), backgroundColor: JD_COLORS[t] })), { stacked: true, horizontal: true });
  document.getElementById('jdCategoryNote').textContent = !catTypes.length ? 'Transfers are counted per item line, not by category.'
    : (res.valueOn && res.byCategory.some((c) => c.value) ? 'Donated stock value: ' + res.byCategory.filter((c) => c.value).map((c) => c.category + ' ' + rand(c.value)).join(' · ') : '');

  // Fail reasons as simple bars
  const maxF = Math.max(1, ...res.failReasons.map((f) => f.count));
  document.getElementById('jdFailNote').textContent = k.failedAttempts ? k.failedAttempts + ' failed attempt' + (k.failedAttempts === 1 ? '' : 's') : '';
  document.getElementById('jdFails').innerHTML = res.failReasons.length ? res.failReasons.map((f) =>
    '<div class="jd-fail-row"><span class="jd-fail-label">' + escapeHtml(f.reason) + '</span>' +
    '<span class="jd-fail-bar"><span style="width:' + Math.round(f.count / maxF * 100) + '%"></span></span>' +
    '<span class="jd-fail-n">' + f.count + '</span></div>').join('') : '<p class="jd-allgood">No failed attempts in this period.</p>';

  // Drivers
  const dc = document.getElementById('jdDriversCard');
  dc.hidden = !res.drivers;
  if (res.drivers) {
    document.getElementById('jdDriversBody').innerHTML = res.drivers.length ? res.drivers.map((d) =>
      '<tr><td><strong>' + escapeHtml(d.name) + '</strong></td><td>' + d.completed + '</td><td>' + (d.onTimePct === null ? '—' : d.onTimePct + '%') +
      '</td><td>' + d.failed + '</td><td>' + d.open + '</td></tr>').join('') : '<tr><td colspan="5" class="muted">No drivers yet.</td></tr>';
  }
}

function jdBarChart(key, canvasId, labels, datasets, opts) {
  if (jdCharts[key]) { jdCharts[key].destroy(); delete jdCharts[key]; }
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(canvasId);
  const horizontal = !!(opts && opts.horizontal);
  const wrap = canvas.parentElement;
  if (horizontal) wrap.style.height = Math.max(160, 46 + labels.length * 34) + 'px';
  const axis = { grid: { color: '#dfe5ee' }, ticks: { color: '#5e6a7a', font: { size: 11 }, precision: 0 }, beginAtZero: true, stacked: !!(opts && opts.stacked) };
  const cat = { grid: { display: false }, ticks: { color: '#5e6a7a', font: { size: 11 }, autoSkip: true, maxRotation: 0 }, stacked: !!(opts && opts.stacked) };
  jdCharts[key] = new Chart(canvas, {
    type: 'bar',
    data: { labels: labels, datasets: datasets.map((d) => Object.assign({ borderRadius: 4, maxBarThickness: 34 }, d)) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom', labels: { boxWidth: 12, color: '#142132', font: { size: 12 } } },
        tooltip: { backgroundColor: '#142132', padding: 10, cornerRadius: 6 }
      },
      scales: horizontal ? { x: axis, y: cat } : { x: cat, y: axis }
    }
  });
}

// ── Monthly report (printable) ───────────────────────────────────────

async function openDeliveriesReport() {
  const month = document.getElementById('jdReportMonth').value;
  if (!/^\d{4}-\d{2}$/.test(month)) { document.getElementById('jdReportMonth').focus(); return; }
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  const btn = document.getElementById('jdReportBtn');
  btn.disabled = true; btn.textContent = 'Preparing…';
  const res = await apiGet('deliveriesDashboard', { email: currentUser.email, period: 'custom', from: month + '-01', to: month + '-' + String(last).padStart(2, '0'),
    branch: document.getElementById('jdBranch').value });
  btn.disabled = false; btn.textContent = 'Open report';
  if (!res.success) { const err = document.getElementById('jdError'); err.textContent = res.error || 'Could not prepare the report.'; err.hidden = false; return; }
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const scope = res.lockedBranch || res.branch || 'All branches';
  openReportViewer('Deliveries report · ' + monthName, scope, deliveriesReportHtml(res, monthName, scope));
}

function deliveriesReportHtml(d, monthName, scope) {
  const e = escapeHtml;
  const k = d.kpis;
  const logo = new URL('assets/logo.jpg', location.href).href;
  const bars = (rows, max) => rows.map((r) => '<tr><td class="lbl">' + e(r.label) + '</td><td class="bar"><span style="width:' +
    (max ? Math.round(r.value / max * 100) : 0) + '%"></span></td><td class="n">' + e(r.text || r.value) + '</td></tr>').join('');
  const types = ['Delivery', 'Collection', 'Transfer'];
  const kpi = (l, v, s) => '<div class="kpi"><div class="l">' + e(l) + '</div><div class="v">' + e(v) + '</div>' + (s ? '<div class="s">' + e(s) + '</div>' : '') + '</div>';
  const totals = d.trend.labels.map((lbl, i) => ({ label: (d.trend.unit === 'week' ? 'Week of ' : '') + lbl, value: types.reduce((s, t) => s + d.trend.series[t][i], 0) }));
  const branchRows = d.byBranch.map((b) => '<tr><td>' + e(b.branch) + '</td>' + types.map((t) => '<td class="c">' + b[t] + '</td>').join('') +
    '<td class="c"><b>' + types.reduce((s, t) => s + b[t], 0) + '</b></td></tr>').join('');
  const catRows = d.byCategory.map((c) => '<tr><td>' + e(c.category) + '</td><td class="c">' + c.Delivery + '</td><td class="c">' + c.Collection + '</td>' +
    (d.valueOn ? '<td class="r">' + (c.value ? e(rand(c.value)) : '—') + '</td>' : '') + '</tr>').join('');
  const kp = [
    kpi('Completed', String(k.completedTotal), types.filter((t) => k.completed[t]).map((t) => jdCount(k.completed[t], t)).join(', ')),
    kpi('On time', k.onTimePct === null ? '—' : k.onTimePct + '%', k.onTimeOf ? k.onTime + ' of ' + k.onTimeOf : ''),
    kpi('New requests', String(k.requested), ''),
    kpi('Failed attempts', String(k.failedAttempts), k.failedJobs ? k.recovered + ' later completed' : ''),
    kpi('Avg turnaround', k.avgDays === null ? '—' : k.avgDays + ' days', 'request to done')
  ];
  if (d.valueOn) kp.push(kpi('Donated stock collected', rand(k.collectionValue || 0), k.valuedCollections + ' valued'));
  return '<!doctype html><html><head><meta charset="utf-8"><title>Deliveries report — ' + e(monthName) + '</title><style>' +
    '@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#142132;margin:0;padding:18px;font-size:12px}' +
    'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0d53af;padding-bottom:10px;margin-bottom:14px}header img{height:46px}' +
    'h1{font-size:20px;margin:0;color:#0d53af}h2{font-size:13px;margin:16px 0 6px;color:#0d53af;text-transform:uppercase;letter-spacing:.04em}' +
    '.sub{color:#5e6a7a;margin-top:2px}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
    '.kpi{border:1px solid #dfe5ee;border-radius:8px;padding:8px 10px}.kpi .l{font-size:10px;color:#5e6a7a;text-transform:uppercase;font-weight:bold}' +
    '.kpi .v{font-size:20px;font-weight:bold;margin-top:2px}.kpi .s{font-size:10px;color:#5e6a7a}' +
    'table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;border-bottom:1px solid #edf1f6;text-align:left;vertical-align:top}th{font-size:10px;color:#5e6a7a;text-transform:uppercase}' +
    '.c{text-align:center}.r{text-align:right}.lbl{width:36%}.n{width:12%;text-align:right;font-weight:bold}.bar span{display:block;height:10px;background:#0d53af;border-radius:3px;min-width:2px}' +
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.issue{color:#c0392b}.ok{color:#1e8449}footer{margin-top:18px;color:#8a95a5;font-size:10px;border-top:1px solid #dfe5ee;padding-top:6px}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>' +
    '<header><img src="' + e(logo) + '" alt=""><div><h1>Deliveries, collections &amp; transfers</h1>' +
    '<div class="sub">' + e(monthName) + ' · ' + e(scope) + '</div></div></header>' +
    '<div class="kpis">' + kp.join('') + '</div>' +
    '<h2>Completed per ' + e(d.trend.unit) + '</h2><table>' + bars(totals, Math.max(0, ...totals.map((t) => t.value))) + '</table>' +
    '<div class="two"><div>' +
      (d.byBranch.length ? '<h2>By branch</h2><table><tr><th>Branch</th><th class="c">Del.</th><th class="c">Coll.</th><th class="c">Transf.</th><th class="c">Total</th></tr>' + branchRows + '</table>' : '') +
      '<h2>Why jobs failed</h2>' + (d.failReasons.length ? '<table>' + bars(d.failReasons.map((f) => ({ label: f.reason, value: f.count })), Math.max(...d.failReasons.map((f) => f.count))) + '</table>' : '<p class="ok">No failed attempts.</p>') +
    '</div><div>' +
      (d.byCategory.length ? '<h2>By stock category</h2><table><tr><th>Category</th><th class="c">Deliveries</th><th class="c">Collections</th>' + (d.valueOn ? '<th class="r">Value</th>' : '') + '</tr>' + catRows + '</table>' : '') +
      '<h2>Transfer problems</h2>' + (d.transferProblems.length ? '<table>' + d.transferProblems.map((t) => '<tr><td><b>' + e(t.ref) + '</b><br>' + e(t.from + ' → ' + t.to) + '</td><td>' +
        t.problems.map((p) => '<div class="issue">' + e(p) + '</div>').join('') + (t.resolution ? '<div>Resolved: ' + e(t.resolution) + '</div>' : '<div><b>Still to resolve</b></div>') + '</td></tr>').join('') + '</table>' : '<p class="ok">None.</p>') +
    '</div></div>' +
    (d.drivers && d.drivers.length ? '<h2>Drivers</h2><table><tr><th>Driver</th><th class="c">Completed</th><th class="c">On time</th><th class="c">Failed attempts</th></tr>' +
      d.drivers.map((x) => '<tr><td>' + e(x.name) + '</td><td class="c">' + x.completed + '</td><td class="c">' + (x.onTimePct === null ? '—' : x.onTimePct + '%') + '</td><td class="c">' + x.failed + '</td></tr>').join('') + '</table>' : '') +
    '<h2>Still open today (' + d.attentionTotal + ' need attention)</h2>' + (d.attention.length ? '<table>' + d.attention.slice(0, 12).map((a) =>
      '<tr><td><b>' + e(a.ref) + '</b></td><td>' + e(a.branch + (a.receivingBranch ? ' → ' + a.receivingBranch : '')) + '</td><td class="' + (a.severity === 1 ? 'issue' : '') + '">' + e(a.issue) + '</td></tr>').join('') + '</table>' : '<p class="ok">Nothing — all on track.</p>') +
    '<footer>Vision Cash-Up · printed ' + e(new Date().toLocaleString('en-ZA')) + ' · On time = completed on or before the required date.</footer>' +
    '</body></html>';
}

// Email links look like …/CashUp/#job=DEL-00012 — remember the job, then
// tidy the address bar so a refresh doesn't reopen it.
let linkedJobRef = (function () {
  const m = /[#&]job=([A-Z]{3}-\d+)/.exec(location.hash || '');
  return m ? m[1] : '';
})();
function takeLinkedJobRef() {
  const ref = linkedJobRef;
  linkedJobRef = '';
  if (ref && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  return ref;
}
window.addEventListener('hashchange', () => {
  const m = /[#&]job=([A-Z]{3}-\d+)/.exec(location.hash || '');
  if (m && currentUser && allowedPages().indexOf('deliveries') !== -1) {
    linkedJobRef = m[1];
    openPage('deliveries');
    openJob(takeLinkedJobRef());
  }
});

// ─────────────────────────────────────────────────────────────────────
// NOTIFICATIONS BELL
// Checks for new notifications every 90 seconds while the app is open.
// ─────────────────────────────────────────────────────────────────────

let bellTimer = null;
let bellItems = [];
let bellBound = false;

function startBell() {
  stopBell();
  const on = featureOn('deliveries');
  document.getElementById('bellBtn').hidden = !on;
  if (!on) return;
  bindBell();
  refreshBell();
  bellTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshBell(); }, 90000);
}

function stopBell() {
  if (bellTimer) clearInterval(bellTimer);
  bellTimer = null;
  document.getElementById('bellBtn').hidden = true;
  document.getElementById('bellPanel').hidden = true;
}

function bindBell() {
  if (bellBound) return;
  bellBound = true;
  const btn = document.getElementById('bellBtn');
  const panel = document.getElementById('bellPanel');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    if (!panel.hidden) refreshBell();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  });
  document.getElementById('bellReadAll').addEventListener('click', () => markBellRead({ all: true }));
  document.getElementById('bellList').addEventListener('click', (e) => {
    const item = e.target.closest('.bell-item');
    if (!item) return;
    panel.hidden = true;
    if (item.dataset.ref && allowedPages().indexOf('deliveries') !== -1) {
      openPage('deliveries');
      openJob(item.dataset.ref);
    }
  });
}

async function refreshBell() {
  if (!currentUser) return;
  const res = await apiGet('notifications', { email: currentUser.email });
  if (!res.success) return;
  bellItems = res.items || [];
  const count = document.getElementById('bellCount');
  count.textContent = res.unread > 9 ? '9+' : String(res.unread);
  count.hidden = !res.unread;
  document.getElementById('bellBtn').setAttribute('aria-label', 'Notifications' + (res.unread ? ' (' + res.unread + ' unread)' : ''));
  document.getElementById('bellList').innerHTML = bellItems.length
    ? bellItems.map((n) =>
        '<button type="button" class="bell-item' + (n.unread ? ' is-unread' : '') + '" data-ref="' + escapeAttr(n.ref) + '">' +
          '<span class="bell-msg">' + escapeHtml(n.message) + '</span>' +
          '<span class="bell-when">' + escapeHtml(formatShortDateTime(n.timestamp)) + '</span></button>').join('')
    : '<p class="muted bell-empty">No notifications yet.</p>';
}

async function markBellRead(opts) {
  if (!currentUser || !featureOn('deliveries')) return;
  if (opts.ref && !bellItems.some((n) => n.unread && n.ref === opts.ref)) return;
  await apiPost('markNotificationsRead', Object.assign({ requesterEmail: currentUser.email }, opts));
  refreshBell();
}

// ─────────────────────────────────────────────────────────────────────
// HEAD OFFICE FINANCE (Pro feature "hoExpenses") + shared categories
// Overview (drill down: category → subcategory → entries), Head Office
// entries, repeat-monthly items due, and category management (Admins).
// ─────────────────────────────────────────────────────────────────────

let finSetup = null;          // categories, branches, permissions
let finSetupLoading = null;
let finUiBound = false;
let finTab = 'overview';
let finCatKind = 'Expense';
let finEntry = null;          // entry being edited (null = new)
let finEntryKind = 'Expense';
let finEntryRequestId = '';
let finReceiptData = '';
let finSummary = null;
const finOpenMajors = {};

async function ensureFinanceSetup(force) {
  if (finSetup && !force) return finSetup;
  if (finSetupLoading && !force) return finSetupLoading;
  finSetupLoading = apiGet('financeSetup', { email: currentUser.email }).then((res) => {
    finSetupLoading = null;
    if (res.success) finSetup = res;
    return finSetup;
  });
  return finSetupLoading;
}

function finMajorByKey(key) { return finSetup ? finSetup.majors.filter((m) => m.key === key)[0] : null; }

function fillSubSelect(sel, majorKey, includeHidden, selected) {
  const m = finMajorByKey(majorKey);
  const subs = m ? m.subs.filter((x) => x.active || includeHidden || x.id === selected) : [];
  sel.innerHTML = '<option value="">' + (m ? 'Choose…' : 'Choose a category first') + '</option>' +
    subs.map((x) => '<option value="' + escapeAttr(x.id) + '"' + (x.id === selected ? ' selected' : '') + '>' +
      escapeHtml(x.name) + (x.active ? '' : ' (hidden)') + '</option>').join('');
}

function finShowNotice(text) {
  const el = document.getElementById('finNotice');
  el.textContent = text; el.hidden = false;
  clearTimeout(finShowNotice._t);
  finShowNotice._t = setTimeout(() => { el.hidden = true; }, 8000);
}
function finShowError(text) {
  const el = document.getElementById('finError');
  el.textContent = text || ''; el.hidden = !text;
}

function bindFinanceUi() {
  if (finUiBound) return;
  finUiBound = true;
  document.querySelectorAll('#finTabs button').forEach((b) => b.addEventListener('click', () => setFinTab(b.dataset.fin)));
  ['finPeriod', 'finBranch', 'finFrom', 'finTo'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
    const custom = document.getElementById('finPeriod').value === 'custom';
    document.getElementById('finFromWrap').hidden = !custom;
    document.getElementById('finToWrap').hidden = !custom;
    loadFinanceOverview();
  }));
  ['finEntryMonth', 'finEntryKind'].forEach((id) => document.getElementById(id).addEventListener('change', loadFinanceEntries));
  document.getElementById('finAddExpense').addEventListener('click', () => openFinEntry(null, 'Expense'));
  document.getElementById('finAddIncome').addEventListener('click', () => openFinEntry(null, 'Income'));
  document.querySelectorAll('#finCatKind button').forEach((b) => b.addEventListener('click', () => {
    finCatKind = b.dataset.kind;
    document.querySelectorAll('#finCatKind button').forEach((x) => x.classList.toggle('active', x === b));
    renderFinCategories();
  }));

  // Overview: expand a category / open a subcategory's entries
  ['finExpenseMajors', 'finIncomeMajors'].forEach((id) => document.getElementById(id).addEventListener('click', (e) => {
    const sub = e.target.closest('[data-sub]');
    if (sub) { openFinDrill(sub.dataset.major, sub.dataset.sub); return; }
    const all = e.target.closest('[data-all]');
    if (all) { openFinDrill(all.dataset.all, ''); return; }
    const major = e.target.closest('[data-major-toggle]');
    if (major) { const k = major.dataset.majorToggle; finOpenMajors[k] = !finOpenMajors[k]; renderFinOverview(); }
  }));
  document.getElementById('finEntryList').addEventListener('click', onFinLineClick);
  document.getElementById('finDrillBody').addEventListener('click', onFinLineClick);
  document.getElementById('finDueList').addEventListener('click', onFinDueClick);
  document.getElementById('finRecList').addEventListener('click', onFinDueClick);
  document.getElementById('finCatList').addEventListener('click', onFinCatClick);

  // Entry form
  document.querySelectorAll('#finEntryBackdrop .seg button').forEach((b) => b.addEventListener('click', () => setFinEntryKind(b.dataset.kind)));
  document.getElementById('finMajor').addEventListener('change', (e) => fillSubSelect(document.getElementById('finSub'), e.target.value, false));
  document.getElementById('finRepeat').addEventListener('change', (e) => {
    document.getElementById('finRepeatDayWrap').hidden = !e.target.checked;
    document.getElementById('finRepeatHint').hidden = !e.target.checked;
  });
  document.getElementById('finDate').addEventListener('change', (e) => {
    const d = Number(String(e.target.value).slice(8, 10));
    if (d) document.getElementById('finRepeatDay').value = Math.min(28, d);
  });
  document.getElementById('finReceipt').addEventListener('change', onFinReceiptChosen);
  document.getElementById('finEntrySave').addEventListener('click', saveFinEntry);
  ['finEntryClose', 'finEntryCancel'].forEach((id) => document.getElementById(id).addEventListener('click', closeFinEntry));
  document.getElementById('finDeleteToggle').addEventListener('click', () => {
    document.getElementById('finDeleteForm').hidden = !document.getElementById('finDeleteForm').hidden;
  });
  document.getElementById('finDeleteConfirm').addEventListener('click', deleteFinEntry);
  document.getElementById('finEntryBackdrop').addEventListener('input', () => { document.getElementById('finEntryError').textContent = ''; });
  document.getElementById('finDrillClose').addEventListener('click', closeFinDrill);
  // The entry form only closes with X or Cancel (so nothing typed is lost);
  // the read-only drill-down still closes on an outside click or Esc.
  guardModalBackdrop('finEntryBackdrop');
  document.getElementById('finDrillBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'finDrillBackdrop') closeFinDrill();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('finEntryBackdrop').hidden && !document.getElementById('finDrillBackdrop').hidden) closeFinDrill();
  });
}

async function loadFinancePage() {
  bindFinanceUi();
  finShowError('');
  const setup = await ensureFinanceSetup(true);
  if (!setup) {
    finShowError('Head Office Finance needs the updated Apps Script. Redeploy it (Manage deployments → Edit → New version), then refresh.');
    return;
  }
  document.getElementById('finAddBtns').hidden = !setup.canCapture;
  document.getElementById('finCatTabBtn').hidden = !setup.canManage;
  const branchSel = document.getElementById('finBranch');
  const keep = branchSel.value;
  branchSel.innerHTML = '<option value="">Everything</option><option value="' + escapeAttr(setup.headOffice) + '">' + escapeHtml(setup.headOffice) + ' only</option>' +
    setup.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  branchSel.value = keep;
  if (!document.getElementById('finEntryMonth').value) document.getElementById('finEntryMonth').value = localToday().slice(0, 7);
  setFinTab(finTab);
}

function setFinTab(tab) {
  if (tab === 'categories' && !(finSetup && finSetup.canManage)) tab = 'overview';
  finTab = tab;
  document.querySelectorAll('#finTabs button').forEach((b) => b.classList.toggle('active', b.dataset.fin === tab));
  ['overview', 'entries', 'due', 'categories'].forEach((t) => { document.getElementById('fin-' + t).hidden = t !== tab; });
  if (tab === 'overview') loadFinanceOverview();
  else if (tab === 'entries') loadFinanceEntries();
  else if (tab === 'due') loadFinanceDue();
  else if (tab === 'categories') renderFinCategories();
}

function finPeriodParams() {
  const p = { email: currentUser.email, period: document.getElementById('finPeriod').value, branch: document.getElementById('finBranch').value };
  if (p.period === 'custom') { p.from = document.getElementById('finFrom').value; p.to = document.getElementById('finTo').value; }
  return p;
}

// ── Overview ─────────────────────────────────────────────────────────

async function loadFinanceOverview() {
  const res = await apiGet('financeSummary', finPeriodParams());
  if (!res.success) { finShowError(res.error); return; }
  finShowError('');
  finSummary = res;
  const badge = document.getElementById('finDueBadge');
  badge.textContent = res.dueCount; badge.hidden = !res.dueCount;
  renderFinOverview();
}

function renderFinOverview() {
  const res = finSummary;
  if (!res) return;
  document.getElementById('finRangeLabel').textContent = dayLabel(res.range.from) + ' – ' + dayLabel(res.range.to) + ' · ' +
    (res.branch === 'Everything' ? 'Head Office and all branches' : res.branch) +
    (res.hiddenCount ? ' · excludes ' + res.hiddenCount + ' categor' + (res.hiddenCount === 1 ? 'y' : 'ies') + ' not shared with you' : '');
  document.getElementById('finKpiIncome').textContent = rand(res.income);
  document.getElementById('finKpiExpense').textContent = rand(res.expense);
  const net = document.getElementById('finKpiNet');
  net.textContent = rand(res.net);
  net.className = 'kpi-value ' + (res.net < 0 ? 'fin-neg' : 'fin-pos');

  ['Expense', 'Income'].forEach((kind) => {
    const majors = res.majors.filter((m) => m.kind === kind);
    const max = Math.max(1, ...majors.map((m) => m.total));
    const html = majors.map((m) => {
      const open = !!finOpenMajors[m.key];
      const subMax = Math.max(1, ...m.subs.map((x) => x.total));
      return '<div class="fin-major' + (open ? ' is-open' : '') + (m.total ? '' : ' is-empty') + '">' +
        '<button type="button" class="fin-bar-row" data-major-toggle="' + escapeAttr(m.key) + '" aria-expanded="' + open + '"' + (m.total ? '' : ' disabled') + '>' +
          '<span class="fin-bar-label"><span class="fin-caret">' + (m.total ? (open ? '▾' : '▸') : '') + '</span>' + escapeHtml(m.name) + '</span>' +
          '<span class="fin-bar-amt">' + rand(m.total) + '</span>' +
          '<span class="fin-bar"><span class="fin-bar-fill fin-' + kind.toLowerCase() + '" style="width:' + (m.total / max * 100).toFixed(1) + '%"></span></span>' +
        '</button>' +
        (open ? '<div class="fin-subs">' + m.subs.map((x) =>
          '<button type="button" class="fin-bar-row fin-sub-row" data-major="' + escapeAttr(m.key) + '" data-sub="' + escapeAttr(x.id) + '">' +
            '<span class="fin-bar-label">' + escapeHtml(x.name) + ' <span class="muted">(' + x.count + ')</span></span>' +
            '<span class="fin-bar-amt">' + rand(x.total) + '</span>' +
            '<span class="fin-bar"><span class="fin-bar-fill fin-' + kind.toLowerCase() + ' is-sub" style="width:' + (x.total / subMax * 100).toFixed(1) + '%"></span></span>' +
          '</button>').join('') +
          '<button type="button" class="link-btn fin-all-link" data-all="' + escapeAttr(m.key) + '">See all ' + m.count + ' entries in ' + escapeHtml(m.name) + ' →</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
    document.getElementById(kind === 'Expense' ? 'finExpenseMajors' : 'finIncomeMajors').innerHTML = html ||
      '<p class="muted">Nothing recorded for this period.</p>';
  });
}

// ── Lists of entries (drill-down and the Entries tab) ─────────────────

function finLineHtml(l) {
  const src = l.source === 'Head Office'
    ? (l.branch && l.branch !== 'Head Office' ? 'Head Office · for ' + l.branch : 'Head Office')
    : l.source + ' · ' + l.branch;
  const canEdit = l.source === 'Head Office' && finSetup && finSetup.canCapture;
  return '<div class="fin-line">' +
    '<div class="fin-line-main">' +
      '<span class="fin-line-desc">' + escapeHtml(l.description) + (l.party ? ' <span class="muted">· ' + escapeHtml(l.party) + '</span>' : '') + '</span>' +
      '<span class="fin-line-meta">' + escapeHtml(dayLabel(l.date)) + ' · ' + escapeHtml(src) +
        (l.sub ? ' · ' + escapeHtml(l.sub) : '') + (l.recurringId ? ' · <span class="fin-rec-tag">monthly</span>' : '') + '</span>' +
    '</div>' +
    '<div class="fin-line-side">' +
      '<span class="fin-line-amt ' + (l.kind === 'Income' ? 'fin-pos' : '') + '">' + (l.kind === 'Income' ? '+' : '') + rand(l.amount) + '</span>' +
      fileButton(l.file, l.source === 'Cash-up' ? 'PDF' : 'Receipt') +
      (canEdit ? '<button type="button" class="link-btn fin-edit" data-ref="' + escapeAttr(l.ref) + '">Edit</button>' : '') +
    '</div></div>';
}

let finLastLines = [];

async function openFinDrill(majorKey, subId) {
  const m = finSummary.majors.filter((x) => x.key === majorKey)[0];
  const sub = subId && m ? m.subs.filter((x) => x.id === subId)[0] : null;
  document.getElementById('finDrillTitle').textContent = (m ? m.name : '') + (sub ? ' › ' + sub.name : '');
  document.getElementById('finDrillSubtitle').textContent = document.getElementById('finRangeLabel').textContent;
  document.getElementById('finDrillBody').innerHTML = '<p class="muted">Loading…</p>';
  document.getElementById('finDrillBackdrop').hidden = false;
  const params = Object.assign(finPeriodParams(), { majorKey: majorKey });
  if (subId) params.subId = subId;
  const res = await apiGet('financeEntries', params);
  if (!res.success) { document.getElementById('finDrillBody').innerHTML = '<p class="error-text">' + escapeHtml(res.error) + '</p>'; return; }
  finLastLines = res.lines;
  document.getElementById('finDrillBody').innerHTML =
    '<div class="fin-drill-total"><span>' + res.count + ' entr' + (res.count === 1 ? 'y' : 'ies') + '</span><strong>' + rand(res.total) + '</strong></div>' +
    '<div class="fin-lines">' + res.lines.map(finLineHtml).join('') + '</div>' +
    (res.count > res.lines.length ? '<p class="muted">Showing the latest ' + res.lines.length + '.</p>' : '');
}
function closeFinDrill() { document.getElementById('finDrillBackdrop').hidden = true; }

async function loadFinanceEntries() {
  const month = document.getElementById('finEntryMonth').value || localToday().slice(0, 7);
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const params = { email: currentUser.email, period: 'custom', from: month + '-01', to: month + '-' + String(last).padStart(2, '0'), source: 'Head Office' };
  const kind = document.getElementById('finEntryKind').value;
  if (kind) params.kind = kind;
  const list = document.getElementById('finEntryList');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const res = await apiGet('financeEntries', params);
  if (!res.success) { list.innerHTML = '<p class="error-text">' + escapeHtml(res.error) + '</p>'; return; }
  finLastLines = res.lines;
  document.getElementById('finEntryCount').textContent = res.count + ' Head Office entr' + (res.count === 1 ? 'y' : 'ies') + ' this month';
  list.innerHTML = res.lines.length ? res.lines.map(finLineHtml).join('') : '<p class="muted">Nothing captured for this month yet.</p>';
}

function onFinLineClick(e) {
  const btn = e.target.closest('.fin-edit');
  if (!btn) return;
  const line = finLastLines.filter((l) => l.ref === btn.dataset.ref)[0];
  if (line) { closeFinDrill(); openFinEntry(line, line.kind); }
}

// ── Add / edit entry ─────────────────────────────────────────────────

function setFinEntryKind(kind) {
  finEntryKind = kind;
  document.querySelectorAll('#finEntryBackdrop .seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.kind === kind);
    b.setAttribute('aria-checked', b.dataset.kind === kind ? 'true' : 'false');
  });
  document.getElementById('finEntryTitle').textContent = (finEntry ? 'Edit ' : 'New ') + kind.toLowerCase();
  document.getElementById('finPartyLabel').textContent = kind === 'Income' ? 'Received from' : 'Paid to';
  const majors = finSetup.majors.filter((m) => m.kind === kind && !m.auto && (!m.hidden || (finEntry && finEntry.majorKey === m.key)));
  const sel = document.getElementById('finMajor');
  sel.innerHTML = '<option value="">Choose…</option>' + majors.map((m) => '<option value="' + escapeAttr(m.key) + '">' + escapeHtml(m.name) + '</option>').join('');
  fillSubSelect(document.getElementById('finSub'), '', false);
}

function monthLabel(ym) {
  const p = String(ym || '').split('-');
  return p.length >= 2 ? new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) : ym;
}

// opts: { due: <due item> } records that month of a repeat item;
//       { template: <repeat item> } edits the repeat item itself.
let finEntryMode = null;
function openFinEntry(line, kind, opts) {
  if (!finSetup) return;
  finEntryMode = opts || null;
  const due = opts && opts.due, tpl = opts && opts.template, src = due || tpl;
  if (src) kind = src.kind;
  finEntry = line;
  finEntryRequestId = makeRequestId();
  finReceiptData = '';
  setFinEntryKind(kind || 'Expense');
  document.querySelector('#finEntryBackdrop .seg').hidden = !!line || !!src;
  const v = (id, val) => { document.getElementById(id).value = val === undefined || val === null ? '' : val; };
  document.getElementById('finMethod').innerHTML = '<option value="">—</option>' + finSetup.methods.map((m) => '<option>' + escapeHtml(m) + '</option>').join('');
  document.getElementById('finFor').innerHTML = '<option value="' + escapeAttr(finSetup.headOffice) + '">' + escapeHtml(finSetup.headOffice) + '</option>' +
    finSetup.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  v('finDate', line ? line.date : localToday());
  v('finAmount', line ? line.amount : '');
  v('finDesc', line ? line.description : '');
  v('finParty', line ? line.party : '');
  v('finMethod', line ? line.method : '');
  v('finRef', line ? line.reference : '');
  v('finFor', line ? line.branch : finSetup.headOffice);
  v('finReceipt', '');
  if (line) {
    v('finMajor', line.majorKey);
    fillSubSelect(document.getElementById('finSub'), line.majorKey, false, line.subId);
  }
  if (src) {
    v('finAmount', src.amount); v('finDesc', src.description); v('finParty', src.party); v('finMethod', src.method);
    v('finFor', src.forBranch); v('finMajor', src.majorKey);
    fillSubSelect(document.getElementById('finSub'), src.majorKey, false, src.subId);
    if (due) v('finDate', due.date <= localToday() ? due.date : localToday());
  }
  const note = document.getElementById('finModeNote');
  note.hidden = !src;
  note.innerHTML = due ? 'Recording <strong>' + escapeHtml(monthLabel(due.month)) + '</strong>. Check the details, change anything that was different this month, and attach the receipt.'
    : (tpl ? 'Changes apply from the next month you record. Months already recorded keep their amounts.' : '');
  ['finDate', 'finRef', 'finReceipt'].forEach((id) => { document.getElementById(id).closest('label').hidden = !!tpl; });
  const info = document.getElementById('finReceiptInfo');
  info.hidden = !(line && line.file);
  info.innerHTML = line && line.file ? 'Current receipt: ' + fileButton(line.file, 'view') + '. Choose a new file to replace it.' : '';
  document.getElementById('finRepeatWrap').hidden = !!line || !!due;
  document.getElementById('finRepeat').checked = false;
  document.getElementById('finRepeat').closest('label').hidden = !!tpl;
  document.getElementById('finRepeatDayWrap').hidden = !tpl;
  document.getElementById('finRepeatHint').hidden = true;
  v('finRepeatDay', tpl ? tpl.dayOfMonth : Math.min(28, Number(localToday().slice(8, 10))));
  document.getElementById('finDeleteWrap').hidden = !line;
  document.getElementById('finDeleteForm').hidden = true;
  v('finDeleteReason', '');
  document.getElementById('finEntryError').textContent = '';
  const btn = document.getElementById('finEntrySave');
  btn.disabled = false; btn.textContent = finSaveLabel();
  if (due) document.getElementById('finEntryTitle').textContent = 'Record ' + due.description;
  if (tpl) document.getElementById('finEntryTitle').textContent = 'Edit repeat item';
  document.getElementById('finEntryBackdrop').hidden = false;
  document.getElementById(line || src ? 'finAmount' : 'finMajor').focus();
}
function finSaveLabel() {
  if (finEntryMode && finEntryMode.due) return 'Save payment';
  return finEntry || (finEntryMode && finEntryMode.template) ? 'Save changes' : 'Save';
}

function closeFinEntry() { document.getElementById('finEntryBackdrop').hidden = true; finEntry = null; finEntryMode = null; }

async function onFinReceiptChosen(e) {
  const file = e.target.files && e.target.files[0];
  const err = document.getElementById('finEntryError');
  finReceiptData = '';
  if (!file) return;
  try {
    if (file.type === 'application/pdf') {
      if (file.size > 5 * 1024 * 1024) { err.textContent = 'That PDF is too large (max 5 MB).'; e.target.value = ''; return; }
      finReceiptData = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Could not read that file.'));
        r.readAsDataURL(file);
      });
    } else if (file.type.startsWith('image/')) {
      finReceiptData = await resizeImageFileToDataUrl(file, PROOF_MAX_DIMENSION, PROOF_JPEG_QUALITY);
    } else {
      err.textContent = 'Choose a photo or a PDF.'; e.target.value = '';
    }
  } catch (ex) {
    err.textContent = ex.message || 'Could not use that file.';
  }
}

async function saveFinEntry() {
  const err = document.getElementById('finEntryError');
  const val = (id) => document.getElementById(id).value.trim();
  const payload = {
    requesterEmail: currentUser.email, kind: finEntryKind, date: val('finDate'), amount: Number(val('finAmount')),
    subId: val('finSub'), description: val('finDesc'), party: val('finParty'), method: val('finMethod'),
    reference: val('finRef'), forBranch: val('finFor'), clientRequestId: finEntryRequestId
  };
  if (finEntry) payload.id = finEntry.ref;
  if (finReceiptData) payload.receipt = finReceiptData;
  const due = finEntryMode && finEntryMode.due, tpl = finEntryMode && finEntryMode.template;
  if (tpl) return saveFinTemplate(payload, tpl);
  if (due) { payload.dueRecurringId = due.recurringId; payload.dueMonth = due.month; }
  if (!finEntry && !due && document.getElementById('finRepeat').checked) {
    payload.repeatMonthly = true;
    payload.dayOfMonth = Number(val('finRepeatDay')) || 1;
  }
  if (!payload.subId) { err.textContent = 'Choose a category and subcategory.'; return; }
  if (!(payload.amount > 0)) { err.textContent = 'Enter an amount greater than zero.'; return; }
  if (!payload.date) { err.textContent = 'Choose the date.'; return; }
  if (!payload.description) { err.textContent = 'Add a short description.'; return; }
  const btn = document.getElementById('finEntrySave');
  btn.disabled = true; btn.textContent = finReceiptData ? 'Uploading…' : 'Saving…';
  const res = await apiPost('financeSave', payload);
  btn.disabled = false; btn.textContent = finSaveLabel();
  if (!res.success) {
    err.textContent = res.networkError ? 'Lost connection — it may have saved. Press Save again: it won\'t create a duplicate.' : (res.error || 'Could not save.');
    return;
  }
  const wasEdit = !!finEntry;
  closeFinEntry();
  finShowNotice(due ? 'Recorded ' + due.description + ' for ' + monthLabel(due.month) + ' as ' + res.id + '.' + (res.warning ? ' Note: ' + res.warning : '')
    : (wasEdit ? 'Updated ' : 'Saved ') + res.id + (res.recurringId ? ' — it will be due again every month.' : '.') + (res.warning ? ' Note: ' + res.warning : ''));
  setFinTab(finTab);
}

async function saveFinTemplate(payload, tpl) {
  const err = document.getElementById('finEntryError');
  const day = Number(document.getElementById('finRepeatDay').value);
  if (!payload.subId) { err.textContent = 'Choose a category and subcategory.'; return; }
  if (!(payload.amount > 0)) { err.textContent = 'Enter an amount greater than zero.'; return; }
  if (!payload.description) { err.textContent = 'Add a short description.'; return; }
  if (!(day >= 1 && day <= 28)) { err.textContent = 'Choose a day from 1 to 28.'; return; }
  const btn = document.getElementById('finEntrySave');
  btn.disabled = true; btn.textContent = 'Saving…';
  const res = await apiPost('financeRecurring', Object.assign({}, payload, { op: 'update', recurringId: tpl.id, dayOfMonth: day }));
  btn.disabled = false; btn.textContent = finSaveLabel();
  if (!res.success) { err.textContent = res.error || 'Could not save.'; return; }
  closeFinEntry();
  finShowNotice('Updated ' + payload.description + '. Months already recorded keep their amounts.');
  setFinTab(finTab);
}

async function deleteFinEntry() {
  const reason = document.getElementById('finDeleteReason').value.trim();
  const err = document.getElementById('finEntryError');
  if (!reason) { err.textContent = 'Please give a reason for deleting it.'; return; }
  const btn = document.getElementById('finDeleteConfirm');
  btn.disabled = true;
  const res = await apiPost('financeDelete', { requesterEmail: currentUser.email, id: finEntry.ref, reason: reason });
  btn.disabled = false;
  if (!res.success) { err.textContent = res.error || 'Could not delete.'; return; }
  const id = finEntry.ref;
  closeFinEntry();
  finShowNotice(id + ' was deleted. It stays in the sheet for the record but no longer counts.');
  setFinTab(finTab);
}

// ── Repeat-monthly: due items ─────────────────────────────────────────

let finDueData = null;
async function loadFinanceDue() {
  const res = await apiGet('financeDue', { email: currentUser.email });
  if (!res.success) { finShowError(res.error); return; }
  finDueData = res;
  const badge = document.getElementById('finDueBadge');
  badge.textContent = res.due.length; badge.hidden = !res.due.length;
  document.getElementById('finDueList').innerHTML = res.due.length ? res.due.map((d, i) =>
    '<div class="fin-due" data-i="' + i + '">' +
      '<button type="button" class="fin-due-open" data-due="record">' +
        '<span class="fin-line-desc">' + escapeHtml(d.description) + ' <span class="muted">· ' + escapeHtml(monthLabel(d.month)) + '</span></span>' +
        '<span class="fin-line-meta">Due ' + escapeHtml(dayLabel(d.date)) + ' · ' + escapeHtml(d.category) +
        (d.forBranch !== 'Head Office' ? ' · for ' + escapeHtml(d.forBranch) : '') + '</span></button>' +
      '<div class="fin-due-actions">' +
        '<span class="fin-line-amt">' + rand(d.amount) + '</span>' +
        '<button type="button" class="jd-action-btn is-go" data-due="record">Record payment</button>' +
        '<button type="button" class="link-btn" data-due="skip">Skip this month</button>' +
      '</div></div>').join('') : '<p class="muted">Nothing due right now. Each repeat item below shows when it is next due.</p>';
  document.getElementById('finRecList').innerHTML = res.recurring.length ? res.recurring.map((r, i) =>
    '<div class="fin-line"><div class="fin-line-main"><span class="fin-line-desc">' + escapeHtml(r.description) + '</span>' +
      '<span class="fin-line-meta">' + escapeHtml(r.kind) + ' · ' + escapeHtml(r.category) + ' · day ' + r.dayOfMonth + ' of each month' +
      (r.forBranch !== 'Head Office' ? ' · for ' + escapeHtml(r.forBranch) : '') + '</span>' +
      (r.nextDue ? '<span class="fin-next-due' + (r.nextDue <= localToday() ? ' is-due' : '') + '">' +
        (r.nextDue <= localToday() ? 'Due now (' + escapeHtml(dayLabel(r.nextDue)) + ') — see above' : 'Next due ' + escapeHtml(dayLabel(r.nextDue))) + '</span>' : '') +
      '</div>' +
      '<div class="fin-line-side"><span class="fin-line-amt">' + rand(r.amount) + '</span>' +
      '<span class="fin-rec-actions"><button type="button" class="link-btn" data-rec-edit="' + i + '">Edit</button>' +
      '<button type="button" class="link-btn fin-stop" data-stop="' + escapeAttr(r.id) + '">Stop</button></span></div></div>').join('')
    : '<p class="muted">None yet. Tick "Repeat every month" when capturing rent, wages or a debit order.</p>';
}

async function onFinDueClick(e) {
  const stop = e.target.closest('[data-stop]');
  if (stop) {
    if (!confirm('Stop repeating this item? Past entries are kept.')) return;
    const res = await apiPost('financeRecurring', { requesterEmail: currentUser.email, op: 'stop', recurringId: stop.dataset.stop });
    if (!res.success) { finShowError(res.error); return; }
    loadFinanceDue();
    return;
  }
  const edit = e.target.closest('[data-rec-edit]');
  if (edit) { openFinEntry(null, null, { template: finDueData.recurring[Number(edit.dataset.recEdit)] }); return; }
  const btn = e.target.closest('[data-due]');
  if (!btn) return;
  const row = btn.closest('.fin-due');
  const d = finDueData.due[Number(row.dataset.i)];
  if (btn.dataset.due === 'record') { openFinEntry(null, d.kind, { due: d }); return; }
  if (!confirm('Skip ' + d.description + ' for ' + monthLabel(d.month) + '? Use this when it wasn\'t paid that month.')) return;
  btn.disabled = true;
  const res = await apiPost('financeRecurring', { requesterEmail: currentUser.email, op: 'skip', recurringId: d.recurringId, month: d.month });
  if (!res.success) { finShowError(res.error); btn.disabled = false; return; }
  finShowError('');
  finShowNotice('Skipped ' + d.description + ' for ' + monthLabel(d.month) + '.');
  loadFinanceDue();
}

// ── Categories (Admins) ───────────────────────────────────────────────

function renderFinCategories() {
  if (!finSetup) return;
  const majors = finSetup.majors.filter((m) => m.kind === finCatKind);
  document.getElementById('finCatList').innerHTML = majors.map((m) =>
    '<div class="fin-cat' + (m.hidden ? ' is-hidden' : '') + '">' +
      '<div class="fin-cat-head"><strong>' + escapeHtml(m.name) + '</strong>' +
        (m.hidden ? ' <span class="status-tag tag-inactive">Hidden</span>' : '') +
        (m.auto ? '' : '<button type="button" class="link-btn" data-cat="toggleMajor" data-major="' + escapeAttr(m.key) + '">' + (m.hidden ? 'Show' : 'Hide') + ' category</button>') +
      '</div>' +
      (m.auto ? '<p class="muted fin-cat-note">Filled in automatically from the daily cash-ups (one line per branch).</p>' :
        '<ul class="fin-cat-subs">' + m.subs.map((x) =>
          '<li class="' + (x.active ? '' : 'is-hidden') + '"><span>' + escapeHtml(x.name) + (x.active ? '' : ' <span class="muted">(hidden)</span>') + '</span>' +
          '<span class="fin-cat-actions"><button type="button" class="link-btn" data-cat="rename" data-sub="' + escapeAttr(x.id) + '" data-name="' + escapeAttr(x.name) + '">Rename</button>' +
          '<button type="button" class="link-btn" data-cat="toggle" data-sub="' + escapeAttr(x.id) + '">' + (x.active ? 'Hide' : 'Show') + '</button></span></li>').join('') + '</ul>' +
        '<div class="fin-cat-add"><input type="text" placeholder="New subcategory under ' + escapeAttr(m.name) + '" maxlength="60" data-add-input="' + escapeAttr(m.key) + '">' +
          '<button type="button" class="jd-action-btn" data-cat="add" data-major="' + escapeAttr(m.key) + '">Add</button></div>') +
    '</div>').join('');
}

async function onFinCatClick(e) {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  const op = btn.dataset.cat;
  const payload = { requesterEmail: currentUser.email, op: op };
  if (op === 'add') {
    const input = document.querySelector('[data-add-input="' + btn.dataset.major + '"]');
    payload.majorKey = btn.dataset.major;
    payload.name = input.value.trim();
    if (!payload.name) { input.focus(); return; }
  } else if (op === 'rename') {
    const name = prompt('New name for "' + btn.dataset.name + '":', btn.dataset.name);
    if (!name || name.trim() === btn.dataset.name) return;
    payload.subId = btn.dataset.sub;
    payload.name = name.trim();
  } else if (op === 'toggle') {
    payload.subId = btn.dataset.sub;
  } else if (op === 'toggleMajor') {
    payload.majorKey = btn.dataset.major;
  }
  btn.disabled = true;
  const res = await apiPost('financeCategory', payload);
  btn.disabled = false;
  if (!res.success) { finShowError(res.error); return; }
  finShowError('');
  await ensureFinanceSetup(true);
  renderFinCategories();
}

// ─────────────────────────────────────────────────────────────────────
// FILE VIEWER — receipts, proof photos and PDFs open inside the app.
// The server only hands a file over if the signed-in role may see that
// record; there are no shareable Drive links. Print and Download included.
// ─────────────────────────────────────────────────────────────────────

let fileView = null; // { blobUrl, mimeType, name }

// A small button that opens a file in the viewer. `ref` is what the server
// sent, e.g. { t: 'cashup', r: 'VCU-…' } — or null when there's no file.
function fileButton(ref, label) {
  if (!ref) return '';
  return '<button type="button" class="file-link" data-file-t="' + escapeAttr(ref.t) + '" data-file-r="' + escapeAttr(ref.r) + '"' +
    (ref.l ? ' data-file-l="' + escapeAttr(ref.l) + '"' : '') + '>' + escapeHtml(label) + '</button>';
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.file-link');
  if (!btn) return;
  e.preventDefault();
  openFileViewer({ t: btn.dataset.fileT, r: btn.dataset.fileR, l: btn.dataset.fileL }, btn.textContent);
});

async function openFileViewer(ref, label) {
  closeFileViewer();
  document.getElementById('fileTitle').textContent = label || 'File';
  document.getElementById('fileSubtitle').textContent = 'Loading…';
  document.getElementById('fileBody').innerHTML = '<p class="muted file-loading">Opening the file…</p>';
  document.getElementById('filePrint').disabled = true;
  document.getElementById('fileDownload').disabled = true;
  document.getElementById('fileDownload').hidden = false;
  document.getElementById('fileBackdrop').hidden = false;
  const params = { email: currentUser.email, t: ref.t, r: ref.r };
  if (ref.l) params.l = ref.l;
  const res = await apiGet('file', params);
  if (document.getElementById('fileBackdrop').hidden) return;
  if (!res.success) {
    document.getElementById('fileSubtitle').textContent = '';
    document.getElementById('fileBody').innerHTML = '<p class="error-text">' + escapeHtml(res.error === 'Unknown action'
      ? 'Opening files in the app needs the updated Apps Script. Redeploy it, then try again.' : (res.error || 'Could not open the file.')) + '</p>';
    return;
  }
  const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: res.mimeType });
  fileView = { blobUrl: URL.createObjectURL(blob), mimeType: res.mimeType, name: res.name };
  document.getElementById('fileTitle').textContent = res.title || label;
  document.getElementById('fileSubtitle').textContent = res.name;
  const body = document.getElementById('fileBody');
  if (res.mimeType === 'application/pdf') {
    body.innerHTML = '<iframe class="file-frame" title="' + escapeAttr(res.name) + '" src="' + fileView.blobUrl + '"></iframe>' +
      '<p class="muted file-pdf-hint">PDF not showing on your phone? Use Download to open it.</p>';
  } else if (/^image\//.test(res.mimeType)) {
    body.innerHTML = '<img class="file-img" alt="' + escapeAttr(res.name) + '" src="' + fileView.blobUrl + '">';
  } else {
    body.innerHTML = '<p class="muted">This file can\'t be shown here — use Download.</p>';
  }
  document.getElementById('filePrint').disabled = false;
  document.getElementById('fileDownload').disabled = false;
}

// A report built in the app (e.g. the monthly deliveries report), shown in
// the same viewer with a Print button. "Save as PDF" is in the print dialog.
function openReportViewer(title, subtitle, html) {
  closeFileViewer();
  fileView = { html: html, name: title };
  document.getElementById('fileTitle').textContent = title;
  document.getElementById('fileSubtitle').textContent = subtitle + ' · to save a PDF, choose "Save as PDF" when printing';
  const frame = document.createElement('iframe');
  frame.className = 'file-frame report-frame';
  frame.title = title;
  frame.srcdoc = html;
  const body = document.getElementById('fileBody');
  body.innerHTML = '';
  body.appendChild(frame);
  document.getElementById('filePrint').disabled = false;
  document.getElementById('fileDownload').hidden = true;
  document.getElementById('fileBackdrop').hidden = false;
}

function closeFileViewer() {
  document.getElementById('fileBackdrop').hidden = true;
  document.getElementById('fileBody').innerHTML = '';
  if (fileView && fileView.blobUrl) setTimeout(((u) => () => URL.revokeObjectURL(u))(fileView.blobUrl), 60000);
  fileView = null;
}

function printFile() {
  if (!fileView) return;
  if (fileView.html) {
    const shown = document.querySelector('#fileBody .report-frame');
    try { shown.contentWindow.focus(); shown.contentWindow.print(); return; } catch (err) { /* fall through to a new window */ }
    const w = window.open('', '_blank');
    if (w) { w.document.write(fileView.html); w.document.close(); w.onload = () => w.print(); }
    return;
  }
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  const done = () => setTimeout(() => frame.remove(), 60000);
  if (fileView.mimeType === 'application/pdf') {
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (err) { window.open(fileView.blobUrl, '_blank'); } // some phones can't print a PDF from inside a page
      done();
    };
    frame.src = fileView.blobUrl;
  } else {
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write('<!doctype html><html><head><title>' + escapeHtml(fileView.name) + '</title><style>@page{margin:10mm}' +
      'body{margin:0;text-align:center}img{max-width:100%;max-height:270mm}</style></head><body>' +
      '<img src="' + fileView.blobUrl + '" onload="setTimeout(function(){window.focus();window.print();},50)"></body></html>');
    doc.close();
    done();
  }
}

function downloadBlob(blobUrl, name) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

document.getElementById('fileClose').addEventListener('click', closeFileViewer);
document.getElementById('filePrint').addEventListener('click', printFile);
document.getElementById('fileDownload').addEventListener('click', () => { if (fileView) downloadBlob(fileView.blobUrl, fileView.name); });
document.getElementById('fileBackdrop').addEventListener('click', (e) => { if (e.target.id === 'fileBackdrop') closeFileViewer(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('fileBackdrop').hidden) { e.stopImmediatePropagation(); closeFileViewer(); }
}, true);

// ─────────────────────────────────────────────────────────────────────
// DOWNLOADS (Pro feature "downloads") — CSV per dataset + Excel workbook
// ─────────────────────────────────────────────────────────────────────

let dlCatalog = null;
let dlBound = false;

async function loadDownloadsPage() {
  if (!dlBound) {
    dlBound = true;
    ['dlPeriod', 'dlBranch'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
      const custom = document.getElementById('dlPeriod').value === 'custom';
      document.getElementById('dlFromWrap').hidden = !custom;
      document.getElementById('dlToWrap').hidden = !custom;
    }));
    document.getElementById('dlList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]');
      if (b) downloadCsv(b.dataset.dl, b);
    });
    document.getElementById('dlAllBtn').addEventListener('click', downloadWorkbook);
  }
  const err = document.getElementById('dlError');
  err.hidden = true;
  const res = await apiGet('exportCatalog', { email: currentUser.email });
  if (!res.success) {
    err.textContent = res.error === 'Unknown action' ? 'Downloads need the updated Apps Script. Redeploy it, then refresh.' : res.error;
    err.hidden = false;
    document.getElementById('dlList').innerHTML = '';
    return;
  }
  dlCatalog = res;
  const branchSel = document.getElementById('dlBranch');
  if (branchSel.options.length < 2) {
    const br = await apiGet('branches', {});
    const branches = (br.success && br.branches) || [];
    branchSel.innerHTML = '<option value="">Everything</option><option value="Head Office">Head Office only</option>' +
      branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  }
  document.getElementById('dlList').innerHTML = res.datasets.map((d) =>
    '<div class="dl-item"><div><strong>' + escapeHtml(d.title) + '</strong><span class="muted">' + escapeHtml(d.description) + '</span></div>' +
    '<button type="button" class="file-act-btn" data-dl="' + escapeAttr(d.key) + '">CSV</button></div>').join('');
}

function dlParams(key) {
  const p = { email: currentUser.email, dataset: key, branch: document.getElementById('dlBranch').value };
  const period = document.getElementById('dlPeriod').value;
  if (period === 'all') { p.period = 'custom'; p.from = '2000-01-01'; p.to = localToday(); }
  else if (period === 'custom') {
    p.period = 'custom'; p.from = document.getElementById('dlFrom').value; p.to = document.getElementById('dlTo').value;
    if (!p.from || !p.to) return null;
  } else { p.period = period; }
  return p;
}

function dlFileName(res, ext) {
  const scope = res.branch ? '_' + res.branch.replace(/[^A-Za-z0-9]+/g, '') : '';
  return (res.name || 'Export') + '_' + (res.file || res.key) + scope + '_' + res.range.from + '_to_' + res.range.to + '.' + ext;
}

function csvCell(v, type) {
  if (v === null || v === undefined) v = '';
  if (type === 'money' && v !== '') v = (Number(v) || 0).toFixed(2);
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function fetchExport(key) {
  const p = dlParams(key);
  if (!p) { dlShowError('Choose both dates for a custom range.'); return null; }
  const res = await apiGet('export', p);
  if (!res.success) { dlShowError(res.error || 'Could not prepare the download.'); return null; }
  return res;
}
function dlShowError(text) {
  const err = document.getElementById('dlError');
  err.textContent = text; err.hidden = !text;
}

async function downloadCsv(key, btn) {
  dlShowError('');
  btn.disabled = true; btn.textContent = 'Preparing…';
  const res = await fetchExport(key);
  btn.disabled = false; btn.textContent = 'CSV';
  if (!res) return;
  const lines = [res.columns.map((c) => csvCell(c.name)).join(',')]
    .concat(res.rows.map((r) => r.map((v, i) => csvCell(v, res.columns[i].type)).join(',')));
  // The BOM at the start lets Excel read names, "›" and accents correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  downloadBlob(url, dlFileName(res, 'csv'));
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  document.getElementById('dlStatus').textContent = res.title + ': ' + res.rows.length + ' row' + (res.rows.length === 1 ? '' : 's') + ' downloaded.';
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-src="' + src + '"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the Excel tool. Check your connection.'));
    document.head.appendChild(s);
  });
}

async function downloadWorkbook() {
  dlShowError('');
  if (!dlCatalog || !dlCatalog.datasets.length) return;
  const btn = document.getElementById('dlAllBtn');
  const status = document.getElementById('dlStatus');
  btn.disabled = true;
  try {
    status.textContent = 'Loading the Excel tool…';
    await loadScriptOnce('vendor/xlsx.full.min.js');
    const wb = XLSX.utils.book_new();
    let first = null;
    for (let i = 0; i < dlCatalog.datasets.length; i++) {
      const d = dlCatalog.datasets[i];
      status.textContent = 'Preparing ' + d.title + ' (' + (i + 1) + ' of ' + dlCatalog.datasets.length + ')…';
      const res = await fetchExport(d.key);
      if (!res) throw new Error('Stopped: ' + d.title + ' could not be prepared.');
      first = first || res;
      const aoa = [res.columns.map((c) => c.name)].concat(res.rows.map((r) => r.map((v, ci) => {
        const t = res.columns[ci].type;
        if ((t === 'money' || t === 'int') && v !== '' && v !== null && v !== undefined && !isNaN(Number(v))) return Number(v);
        return v === null || v === undefined ? '' : v;
      })));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Money columns show two decimals; columns sized to their content.
      res.columns.forEach((c, ci) => {
        if (c.type !== 'money') return;
        for (let ri = 1; ri < aoa.length; ri++) {
          const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
          if (cell && cell.t === 'n') cell.z = '#,##0.00';
        }
      });
      ws['!cols'] = res.columns.map((c, ci) => ({ wch: Math.min(40, Math.max(c.name.length, ...aoa.slice(1, 200).map((r) => String(r[ci]).length)) + 2) }));
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws, d.title.replace(/[\\/?*[\]:]/g, '').slice(0, 31));
    }
    const name = dlFileName(Object.assign({}, first, { file: 'Everything' }), 'xlsx');
    XLSX.writeFile(wb, name);
    status.textContent = 'Downloaded ' + name + ' (' + dlCatalog.datasets.length + ' sheets).';
  } catch (err) {
    status.textContent = '';
    dlShowError(err.message || 'Could not build the Excel file.');
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// DEVELOPER TAB — bundle switch, Pro feature ticks, developers, password
// ─────────────────────────────────────────────────────────────────────

let devState = null;      // last devSettings response
let devDraft = null;      // { bundle, ticks: { key: bool } } — unsaved choices
let devUiBound = false;

async function loadDeveloperTab() {
  bindDeveloperUi();
  const res = await apiGet('devSettings', { email: currentUser.email });
  if (!res.success) {
    document.getElementById('devFeatureList').innerHTML = '<p class="error-text">' + escapeHtml(res.error) + '</p>';
    return;
  }
  devState = res;
  devDraft = { bundle: res.bundle, ticks: {} };
  res.features.forEach((f) => { devDraft.ticks[f.key] = f.ticked; });
  renderDevSettings();
  renderDevList(res.developers);
  renderDevLog(res.log);
  renderSecurityCard(res);
  loadViewAsUsers();
}

async function loadViewAsUsers() {
  const sel = document.getElementById('viewAsUser');
  const res = await apiGet('allUsers', { email: currentUser.email });
  if (!res.success) { sel.innerHTML = '<option value="">Could not load people</option>'; return; }
  const people = res.users.filter((u) => u.role !== 'Developer' && u.status)
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  sel.innerHTML = '<option value="">Choose a person…</option>' + people.map((u) =>
    '<option value="' + escapeAttr(u.email) + '">' + escapeHtml(u.fullName + ' — ' + (ROLE_LABELS[u.role] || u.role || 'no role') +
      (u.branch ? ' · ' + u.branch : '') + (u.status !== 'Approved' ? ' (' + u.status + ')' : '')) + '</option>').join('');
}

function renderSecurityCard(res) {
  document.getElementById('secCodes').checked = !!res.signInCodes;
  const b = res.backup || {};
  document.getElementById('backupStatus').innerHTML =
    (b.scheduled === true ? '<span class="ok-text">✓ Scheduled for the 1st of each month at about 02:00.</span>'
      : '<span class="warn-text">Not scheduled yet — in the Apps Script editor, choose <strong>setUpSchedules</strong> and press Run (once).</span>') +
    ' The last 12 copies are kept in the Drive folder "Vision CashUp Backups".' +
    (b.last ? '<br>Last backup: ' + escapeHtml(b.last) : '<br>No backup made yet.');
}

async function saveSecurityClick() {
  const msg = document.getElementById('secMsg');
  const on = document.getElementById('secCodes').checked;
  if (on && !confirm('Switch on sign-in codes? Everyone will need a code emailed to them the next time they open the app.')) {
    document.getElementById('secCodes').checked = false; return;
  }
  const res = await apiPost('saveSignInCodes', { requesterEmail: currentUser.email, on: on });
  msg.className = 'dev-msg' + (res.success ? '' : ' is-error');
  msg.textContent = res.success ? (res.unchanged ? 'No change.' : 'Saved — sign-in codes are ' + (on ? 'on.' : 'off.')) : (res.error === 'Unknown action' ? 'Redeploy the Apps Script first.' : res.error);
}

async function backupNowClick() {
  const btn = document.getElementById('backupNowBtn');
  const msg = document.getElementById('backupMsg');
  btn.disabled = true; btn.textContent = 'Backing up…';
  const res = await apiPost('backupNow', { requesterEmail: currentUser.email });
  btn.disabled = false; btn.textContent = 'Back up now';
  msg.className = 'dev-msg' + (res.success ? '' : ' is-error');
  msg.textContent = res.success ? 'Saved a copy: ' + res.name : (res.error === 'Unknown action' ? 'Redeploy the Apps Script first.' : res.error);
  if (res.success) loadDeveloperTab();
}

function bindDeveloperUi() {
  if (devUiBound) return;
  devUiBound = true;
  document.querySelectorAll('.bundle-switch button').forEach((b) => b.addEventListener('click', () => {
    if (!devDraft) return;
    devDraft.bundle = b.dataset.bundle;
    renderDevSettings();
  }));
  document.getElementById('devFeatureList').addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox][data-key]') && devDraft) {
      devDraft.ticks[e.target.dataset.key] = e.target.checked;
      renderDevSettings();
    }
  });
  document.getElementById('devSaveSettings').addEventListener('click', saveDevSettingsClick);
  document.getElementById('viewAsStart').addEventListener('click', startViewAsClick);
  document.getElementById('secSave').addEventListener('click', saveSecurityClick);
  document.getElementById('backupNowBtn').addEventListener('click', backupNowClick);
  document.getElementById('addDevBtn').addEventListener('click', addDeveloperClick);
  document.getElementById('changePwBtn').addEventListener('click', changePasswordClick);
}

function devDraftChanged() {
  if (!devState || !devDraft) return false;
  if (devDraft.bundle !== devState.bundle) return true;
  return devState.features.some((f) => devDraft.ticks[f.key] !== f.ticked);
}

function renderDevSettings() {
  const pro = devDraft.bundle === 'Pro';
  document.querySelectorAll('.bundle-switch button').forEach((b) => {
    const on = b.dataset.bundle === devDraft.bundle;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  document.getElementById('bundleHint').textContent = pro
    ? 'Pro: the ticked features below are switched on for everyone they apply to.'
    : 'Standard: the app works exactly as the Standard Bundle. Pro features are off (your ticks are remembered for when you switch to Pro).';

  document.getElementById('devFeatureList').innerHTML = devState.features.map((f) => {
    const ticked = devDraft.ticks[f.key];
    const parent = f.requires ? devState.features.filter((x) => x.name === f.requires)[0] : null;
    const willBeOn = pro && ticked && (!parent || devDraft.ticks[parent.key]);
    return '<label class="feature-row' + (pro ? '' : ' is-disabled') + '">' +
      '<input type="checkbox" data-key="' + escapeAttr(f.key) + '"' + (ticked ? ' checked' : '') + (pro ? '' : ' disabled') + '>' +
      '<span class="feature-body">' +
        '<span class="feature-name">' + escapeHtml(f.name) +
          ' <span class="feature-tag tag-bundle">' + escapeHtml(f.bundle) + '</span>' +
          ' <span class="feature-tag ' + (f.stage === 'Live' ? 'tag-live' : 'tag-placeholder') + '">' + escapeHtml(f.stage) + '</span>' +
        '</span>' +
        '<span class="feature-desc">' + escapeHtml(f.description) + '</span>' +
        (f.requires ? '<span class="feature-req">Needs ' + escapeHtml(f.requires) + '</span>' : '') +
      '</span>' +
      '<span class="feature-state ' + (willBeOn ? 'on' : 'off') + '">' + (willBeOn ? 'On' : 'Off') + '</span>' +
    '</label>' + (f.key === 'weeklyEmail' ? weeklyEmailExtraHtml() : '');
  }).join('');

  const saveBtn = document.getElementById('devSaveSettings');
  const changed = devDraftChanged();
  saveBtn.disabled = !changed;
  saveBtn.textContent = changed ? 'Save bundle settings' : 'Saved';
}

function weeklyEmailExtraHtml() {
  const sched = devState.weeklyEmailScheduled;
  const status = sched === true ? '<span class="ok-text">✓ Scheduled for Mondays at about 07:00</span>'
    : (sched === false ? '<span class="warn-text">Not scheduled yet — in the Apps Script editor, choose <strong>setUpSchedules</strong> in the function list and press Run (once).</span>'
      : '<span class="muted">Schedule status unknown until <strong>setUpSchedules</strong> has been run once in the Apps Script editor.</span>');
  return '<div class="feature-extra">' + status +
    ' <button type="button" class="link-btn" id="weeklyPreviewBtn">Send me a preview</button><span class="muted" id="weeklyPreviewMsg"></span></div>';
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#weeklyPreviewBtn');
  if (!btn) return;
  const msg = document.getElementById('weeklyPreviewMsg');
  btn.disabled = true; msg.textContent = ' Sending…';
  const res = await apiPost('sendWeeklyEmailPreview', { requesterEmail: currentUser.email });
  btn.disabled = false;
  msg.textContent = res.success ? ' Sent to ' + currentUser.email + '.' : ' ' + (res.error === 'Unknown action' ? 'Redeploy the Apps Script first.' : res.error);
});

async function saveDevSettingsClick() {
  const btn = document.getElementById('devSaveSettings');
  const msg = document.getElementById('devSettingsMsg');
  msg.textContent = ''; msg.className = 'dev-msg';
  btn.disabled = true; btn.textContent = 'Saving…';
  const res = await apiPost('saveDevSettings', { requesterEmail: currentUser.email, bundle: devDraft.bundle, features: devDraft.ticks });
  if (!res.success) {
    msg.textContent = res.error || 'Could not save.'; msg.className = 'dev-msg error-text';
    btn.disabled = false; btn.textContent = 'Save bundle settings';
    return;
  }
  // Refresh this developer's own tabs straight away; everyone else picks up
  // the change the next time they open or refresh the app.
  const pro = devDraft.bundle === 'Pro';
  devState.features.forEach((f) => { currentUser.features[f.key] = pro && !!devDraft.ticks[f.key]; });
  buildNav();
  startBell();
  openPage('developer');
  msg.textContent = 'Saved. Everyone else sees the change the next time they open or refresh the app.';
  msg.className = 'dev-msg ok-text';
}

function renderDevList(devs) {
  document.getElementById('devList').innerHTML = (devs || []).map((d) =>
    '<div class="dev-row"><div><strong>' + escapeHtml(d.fullName) + '</strong>' +
      (sameEmail(d.email, currentUser.email) ? ' <span class="muted">(you)</span>' : '') +
      '<div class="muted" style="font-size:13px;">' + escapeHtml(d.email) + '</div></div>' +
      '<div class="dev-row-tags">' + statusTag(d.status) +
      (d.hasPassword ? '' : ' <span class="status-tag tag-pending">No password</span>') +
      (sameEmail(d.email, currentUser.email) ? '' : ' <button type="button" class="link-btn" data-dev-reset="' + escapeAttr(d.email) + '">Reset password</button>') +
      '</div></div>' +
      (sameEmail(d.email, currentUser.email) ? '' :
        '<div class="dev-reset-form" data-dev-reset-form="' + escapeAttr(d.email) + '" hidden>' +
          '<label>New temporary password for ' + escapeHtml(d.fullName) +
          ' <input type="text" class="dev-reset-pw" autocomplete="off" spellcheck="false" placeholder="At least 8 characters"></label>' +
          '<p class="muted" style="font-size:13px;margin:0 0 8px;">Send it to them privately; they can change it under "Change my password" after signing in.</p>' +
          '<div class="user-edit-actions"><button type="button" class="btn-secondary" data-dev-reset-cancel>Cancel</button>' +
          '<button type="button" class="btn-primary" data-dev-reset-save>Set password</button></div>' +
          '<p class="dev-msg"></p></div>')
  ).join('') + '<p class="muted" style="font-size:13px;">Passwords can\'t be shown or resent — only a scrambled version is kept. Use Reset password to set a temporary one. To switch a developer off, use Approvals → All users → Edit.</p>';
}

document.getElementById('devList').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-dev-reset]');
  if (open) {
    document.querySelectorAll('[data-dev-reset-form]').forEach((f) => { f.hidden = f.dataset.devResetForm !== open.dataset.devReset || !f.hidden; });
    const form = document.querySelector('[data-dev-reset-form="' + open.dataset.devReset + '"]');
    if (form && !form.hidden) form.querySelector('input').focus();
    return;
  }
  const form = e.target.closest('[data-dev-reset-form]');
  if (!form) return;
  const msg = form.querySelector('.dev-msg');
  if (e.target.closest('[data-dev-reset-cancel]')) { form.hidden = true; form.querySelector('input').value = ''; msg.textContent = ''; return; }
  const save = e.target.closest('[data-dev-reset-save]');
  if (!save) return;
  const pw = form.querySelector('input').value;
  if (pw.length < 8) { msg.className = 'dev-msg is-error'; msg.textContent = 'Use at least 8 characters.'; return; }
  save.disabled = true; save.textContent = 'Saving…';
  const res = await apiPost('resetDeveloperPassword', { requesterEmail: currentUser.email, targetEmail: form.dataset.devResetForm, password: pw });
  save.disabled = false; save.textContent = 'Set password';
  msg.className = 'dev-msg' + (res.success ? '' : ' is-error');
  msg.textContent = res.success ? 'Done. Their new temporary password is set — send it to them privately.' : (res.error === 'Unknown action' ? 'Redeploy the Apps Script first.' : res.error);
  if (res.success) form.querySelector('input').value = '';
});

function renderDevLog(log) {
  const el = document.getElementById('devLog');
  if (!log || !log.length) { el.innerHTML = '<p class="muted">No changes yet.</p>'; return; }
  el.innerHTML = '<ul class="dev-log">' + log.map((l) =>
    '<li><span class="dev-log-when">' + escapeHtml(formatShortDateTime(l.timestamp)) + '</span>' +
    '<span>' + escapeHtml(l.change) + '</span><span class="muted">' + escapeHtml(l.email) + '</span></li>').join('') + '</ul>';
}

async function addDeveloperClick() {
  const msg = document.getElementById('addDevMsg');
  const btn = document.getElementById('addDevBtn');
  msg.textContent = ''; msg.className = 'dev-msg';
  const payload = {
    requesterEmail: currentUser.email,
    fullName: document.getElementById('newDevName').value.trim(),
    email: document.getElementById('newDevEmail').value.trim(),
    contact: document.getElementById('newDevContact').value.trim(),
    password: document.getElementById('newDevPassword').value
  };
  if (!payload.fullName || !payload.email) { msg.textContent = 'Full name and email are required.'; msg.className = 'dev-msg error-text'; return; }
  if (payload.password.length < 8) { msg.textContent = 'Temporary password must be at least 8 characters.'; msg.className = 'dev-msg error-text'; return; }
  btn.disabled = true; btn.textContent = 'Adding…';
  const res = await apiPost('addDeveloper', payload);
  btn.disabled = false; btn.textContent = 'Add developer';
  if (!res.success) { msg.textContent = res.error || 'Could not add developer.'; msg.className = 'dev-msg error-text'; return; }
  ['newDevName', 'newDevEmail', 'newDevContact', 'newDevPassword'].forEach((id) => { document.getElementById(id).value = ''; });
  msg.textContent = 'Developer added. Send them the app link and their temporary password privately.';
  msg.className = 'dev-msg ok-text';
  loadDeveloperTab();
}

async function changePasswordClick() {
  const msg = document.getElementById('changePwMsg');
  const btn = document.getElementById('changePwBtn');
  msg.textContent = ''; msg.className = 'dev-msg';
  const current = document.getElementById('pwCurrent').value;
  const next = document.getElementById('pwNew').value;
  const confirm = document.getElementById('pwConfirm').value;
  if (!current || !next) { msg.textContent = 'Fill in your current and new password.'; msg.className = 'dev-msg error-text'; return; }
  if (next.length < 8) { msg.textContent = 'New password must be at least 8 characters.'; msg.className = 'dev-msg error-text'; return; }
  if (next !== confirm) { msg.textContent = 'The new passwords don\'t match.'; msg.className = 'dev-msg error-text'; return; }
  btn.disabled = true; btn.textContent = 'Changing…';
  const res = await apiPost('changeMyPassword', { requesterEmail: currentUser.email, currentPassword: current, newPassword: next });
  btn.disabled = false; btn.textContent = 'Change password';
  if (!res.success) { msg.textContent = res.error || 'Could not change password.'; msg.className = 'dev-msg error-text'; return; }
  ['pwCurrent', 'pwNew', 'pwConfirm'].forEach((id) => { document.getElementById(id).value = ''; });
  msg.textContent = 'Password changed.'; msg.className = 'dev-msg ok-text';
}

// Forms in a pop-up only close with their X or Cancel button. A click on the
// dimmed background just gives the form a little shake instead of closing it
// and losing what was typed.
function guardModalBackdrop(id) {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target.id === id) nudgeModal(id);
  });
}
function nudgeModal(id) {
  const modal = document.querySelector('#' + id + ' .modal');
  if (!modal) return;
  modal.classList.remove('modal-nudge');
  void modal.offsetWidth; // restart the animation
  modal.classList.add('modal-nudge');
}

// ─────────────────────────────────────────────────────────────────────
// ASSETS (Pro feature "assets") — Stage 1: the Asset Register
// Admin & Back Office add and edit; Store Managers see their own branch's
// assets (no values) and can report one as damaged or missing.
// ─────────────────────────────────────────────────────────────────────

let assetData = null;      // the 'assets' response
let assetTab = 'overview';
let assetOpen = null;      // { asset, history, files } shown in the detail window
let assetEditing = null;   // asset being edited, or null for a new one
let assetFileData = '';
let assetReportPhoto = '';
let assetReportMode = 'report';
let assetCatEditing = null;
let assetLoadSeq = 0;

const ASSET_ATTN_STATUSES = ['Damaged', 'Lost', 'Stolen', 'Under Maintenance'];
const ASSET_TABS = ['overview', 'register', 'transfers', 'counts', 'maintenance', 'disposals', 'categories'];

function assetWhen(s) { // "2026-03-15 09:30" or "2026-03-15" → "15/03/2026 09:30"
  return String(s || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1');
}
function assetHeld(a) { return assetData.gone.indexOf(a.status) === -1; }
function assetStatusTag(status) {
  const cls = { 'Available': 'as-ok', 'In Use': 'as-ok', 'Under Maintenance': 'as-warn', 'Damaged': 'as-bad', 'Lost': 'as-bad',
    'Stolen': 'as-bad', 'Transferred': 'as-info' }[status] || 'as-gone';
  return '<span class="status-tag ' + cls + '">' + escapeHtml(status || '—') + '</span>';
}
function assetDaysUntil(day) {
  if (!day) return null;
  const d = new Date(day + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
// Why an asset is in "Needs attention" (empty = it isn't).
function assetAttention(a) {
  const out = [];
  if (a.report) out.push({ level: 'bad', text: 'Reported ' + a.report.type.toLowerCase() + ' by ' + a.report.by + ' on ' + assetWhen(a.report.at).slice(0, 10) });
  if (assetHeld(a) && ASSET_ATTN_STATUSES.indexOf(a.status) !== -1) out.push({ level: a.status === 'Under Maintenance' ? 'warn' : 'bad', text: a.status });
  const w = assetHeld(a) ? assetDaysUntil(a.warrantyUntil) : null;
  if (w !== null && w >= 0 && w <= 30) out.push({ level: 'warn', text: 'Warranty ends ' + (w === 0 ? 'today' : 'in ' + w + ' day' + (w === 1 ? '' : 's')) });
  const sv = assetHeld(a) ? assetDaysUntil(a.nextServiceDue) : null;
  if (sv !== null && sv <= 14) out.push({ level: sv < 0 ? 'bad' : 'warn', text: sv < 0 ? 'Service overdue (' + assetWhen(a.nextServiceDue) + ')' : 'Service due ' + (sv === 0 ? 'today' : 'in ' + sv + ' day' + (sv === 1 ? '' : 's')) });
  if (a.pendingDisposal) out.push({ level: assetData.canApprove ? 'bad' : 'info', text: assetData.canApprove ? 'Disposal waiting for your approval' : 'Disposal waiting for approval' });
  if (a.transfer) {
    const days = Math.max(0, -(assetDaysUntil(a.transfer.startedAt.slice(0, 10)) || 0));
    if (a.transfer.to === assetData.branch) out.push({ level: 'info', text: 'On its way here from ' + a.transfer.from + ' — confirm when it arrives' });
    else if (days >= 7) out.push({ level: 'warn', text: 'In transit to ' + a.transfer.to + ' for ' + days + ' days' });
  }
  return out;
}

async function loadAssetsPage() {
  const seq = ++assetLoadSeq;
  const err = document.getElementById('assetError');
  err.hidden = true;
  if (!assetData) {
    document.getElementById('assetLoading').hidden = false;
    ASSET_TABS.forEach((p) => { document.getElementById('as-' + p).hidden = true; });
  }
  const res = await apiGet('assets', { email: currentUser.email });
  if (seq !== assetLoadSeq) return;
  document.getElementById('assetLoading').hidden = true;
  if (!res.success) {
    err.textContent = res.error === 'Unknown action' ? 'Assets need the updated Apps Script. Ask a developer to redeploy it.' : (res.error || 'Could not load assets.');
    err.hidden = false;
    return;
  }
  const first = !assetData;
  assetData = res;
  if (first) setupAssetFilters();
  document.getElementById('assetAddBtn').hidden = !res.canEdit;
  document.getElementById('assetCatTabBtn').hidden = !res.canManageCategories;
  document.getElementById('assetMtTabBtn').hidden = !res.canEdit;
  document.getElementById('assetDpTabBtn').hidden = !res.canEdit;
  if ((assetTab === 'categories' && !res.canManageCategories) || ((assetTab === 'maintenance' || assetTab === 'disposals') && !res.canEdit)) assetTab = 'overview';
  const pendingDp = res.canApprove ? (res.disposals || []).filter((x) => x.status === 'Pending').length : 0;
  const dpBadge = document.getElementById('assetDpBadge');
  dpBadge.textContent = pendingDp; dpBadge.hidden = !pendingDp;
  const openCt = (res.counts || []).filter((c) => c.status === 'Open').length;
  const ctBadge = document.getElementById('assetCtBadge');
  ctBadge.textContent = openCt; ctBadge.hidden = !openCt;
  const incoming = res.assets.filter((a) => a.transfer && a.transfer.to === res.branch).length;
  const badge = document.getElementById('assetTrBadge');
  badge.textContent = incoming; badge.hidden = !incoming;
  showAssetTab(assetTab);
}

function setupAssetFilters() {
  const d = assetData;
  const opts = (list, first) => (first ? '<option value="">' + escapeHtml(first) + '</option>' : '') +
    list.map((x) => '<option value="' + escapeAttr(x) + '">' + escapeHtml(x) + '</option>').join('');
  document.getElementById('assetOvLocation').innerHTML = opts(d.locations, 'All locations');
  document.getElementById('assetLocFilter').innerHTML = opts(d.locations, 'All locations');
  const multiLoc = d.locations.length > 1;
  document.getElementById('assetOvFilters').hidden = !multiLoc;
  document.getElementById('assetLocFilterWrap').hidden = !multiLoc;
  document.getElementById('assetByLocationWrap').hidden = !multiLoc;
  document.getElementById('assetStatusFilter').innerHTML = '<option value="held">All held</option><option value="attention">Needs attention</option>' +
    '<option value="all">Everything (incl. disposed)</option>' + d.statuses.map((s) => '<option value="' + escapeAttr(s.key) + '">' + escapeHtml(s.key) + '</option>').join('');
  refreshAssetCategoryFilter();
}

function refreshAssetCategoryFilter() {
  const sel = document.getElementById('assetCatFilter');
  const keep = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + assetData.categories
    .filter((c) => c.active || assetData.assets.some((a) => a.categoryId === c.id))
    .map((c) => '<option value="' + escapeAttr(c.id) + '">' + escapeHtml(c.name) + '</option>').join('');
  sel.value = keep;
  if (sel.value !== keep) sel.value = '';
}

function showAssetTab(tab) {
  assetTab = tab;
  document.querySelectorAll('#assetTabs button').forEach((b) => b.classList.toggle('active', b.dataset.as === tab));
  ASSET_TABS.forEach((p) => { document.getElementById('as-' + p).hidden = p !== tab; });
  if (!assetData) return;
  if (tab === 'overview') renderAssetOverview();
  else if (tab === 'register') renderAssetRegister();
  else if (tab === 'transfers') renderAssetTransfers();
  else if (tab === 'maintenance') renderAssetMaintenance();
  else if (tab === 'counts') renderAssetCounts();
  else if (tab === 'disposals') renderAssetDisposals();
  else renderAssetCategories();
}

function assetBarRows(groups, total, onAttr, showValue) {
  if (!groups.length) return '<p class="muted">No assets yet.</p>';
  const max = Math.max.apply(null, groups.map((g) => g.count)) || 1;
  return groups.map((g) =>
    '<div class="fin-major"><button type="button" class="fin-bar-row" ' + onAttr + '="' + escapeAttr(g.key) + '">' +
      '<span class="fin-bar-label">' + escapeHtml(g.label) + '</span>' +
      '<span class="fin-bar-amt">' + g.count + (showValue ? ' <span class="asset-bar-val">· ' + rand(g.value) + '</span>' : '') + '</span>' +
      '<span class="fin-bar"><span class="fin-bar-fill asset-bar-fill" style="width:' + Math.max(3, Math.round(g.count / max * 100)) + '%"></span></span>' +
    '</button></div>').join('');
}

function renderAssetOverview() {
  const d = assetData;
  const loc = document.getElementById('assetOvLocation').value;
  const inLoc = d.assets.filter((a) => !loc || a.location === loc);
  const held = inLoc.filter(assetHeld);
  const attn = inLoc.filter((a) => assetAttention(a).length);
  document.getElementById('assetKpiCount').textContent = held.length;
  document.getElementById('assetKpiValueCard').hidden = !d.canEdit;
  document.getElementById('assetKpiValue').textContent = rand(held.reduce((t, a) => t + (a.value || 0), 0));
  document.getElementById('assetKpiBookCard').hidden = !d.canEdit;
  document.getElementById('assetKpiBook').textContent = rand(held.reduce((t, a) => t + (a.bookValue || 0), 0));
  document.getElementById('assetKpiAttn').textContent = attn.length;
  document.getElementById('assetKpiAttnCard').classList.toggle('is-bad', attn.length > 0);
  document.querySelector('.asset-kpis').classList.toggle('asset-kpis-2', !d.canEdit);

  document.getElementById('assetAttention').innerHTML = attn.length ? attn.map((a) => {
    const why = assetAttention(a);
    return '<button type="button" class="fin-line asset-attn-row" data-asset="' + escapeAttr(a.id) + '">' +
      '<span class="fin-line-main"><span class="fin-line-desc">' + escapeHtml(a.id) + ' · ' + escapeHtml(a.name) + '</span>' +
      '<span class="fin-line-meta">' + escapeHtml(a.location) + ' · ' + escapeHtml(a.category) + '</span></span>' +
      '<span class="asset-attn-why">' + why.map((w) => '<span class="asset-why asset-why-' + w.level + '">' + escapeHtml(w.text) + '</span>').join('') + '</span>' +
    '</button>';
  }).join('') : '<p class="muted asset-all-good">Nothing needs attention.</p>';

  const group = (keyOf, labelOf, order) => {
    const m = {};
    held.forEach((a) => { const k = keyOf(a); (m[k] = m[k] || { key: k, label: labelOf(a), count: 0, value: 0 }); m[k].count++; m[k].value += a.value || 0; });
    const list = Object.keys(m).map((k) => m[k]);
    return order ? list.sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key)) : list.sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
  };
  document.getElementById('assetByLocation').innerHTML = assetBarRows(group((a) => a.location, (a) => a.location, d.locations), held.length, 'data-asset-loc', d.canEdit);
  document.getElementById('assetByCategory').innerHTML = assetBarRows(group((a) => a.categoryId, (a) => a.category), held.length, 'data-asset-cat', d.canEdit);
  const counts = {};
  inLoc.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
  document.getElementById('assetByStatus').innerHTML = d.statuses.filter((s) => counts[s.key]).map((s) =>
    '<button type="button" class="asset-chip" data-asset-status="' + escapeAttr(s.key) + '" title="' + escapeAttr(s.meaning) + '">' +
      assetStatusTag(s.key) + '<strong>' + counts[s.key] + '</strong></button>').join('') || '<p class="muted">No assets yet.</p>';
}

function assetMatches(a, q) {
  if (!q) return true;
  return [a.id, a.name, a.type, a.category, a.location, a.department, a.serial, a.assignedTo, a.supplier, a.notes]
    .join(' ').toLowerCase().indexOf(q) !== -1;
}

function assetRegisterList() {
  const d = assetData;
  const q = document.getElementById('assetSearch').value.trim().toLowerCase();
  const loc = document.getElementById('assetLocFilter').value;
  const cat = document.getElementById('assetCatFilter').value;
  const st = document.getElementById('assetStatusFilter').value || 'held';
  return d.assets.filter((a) => (!loc || a.location === loc) && (!cat || a.categoryId === cat) &&
    (st === 'all' || (st === 'held' ? assetHeld(a) : st === 'attention' ? assetAttention(a).length > 0 : a.status === st)) && assetMatches(a, q))
    .sort((x, y) => (x.id < y.id ? 1 : -1));
}

function renderAssetRegister() {
  const d = assetData;
  const list = assetRegisterList();
  document.querySelector('.asset-table').classList.toggle('no-values', !d.canEdit);
  document.getElementById('assetTableBody').innerHTML = list.map((a) =>
    '<tr data-asset="' + escapeAttr(a.id) + '" tabindex="0">' +
      '<td class="nowrap asset-id-cell">' + escapeHtml(a.id) + (a.report ? ' <span class="asset-flag" title="Problem reported">!</span>' : '') + '</td>' +
      '<td class="asset-name-cell"><strong>' + escapeHtml(a.name) + '</strong>' + (a.serial ? '<span class="cell-time">S/N ' + escapeHtml(a.serial) + '</span>' : '') + '</td>' +
      '<td>' + escapeHtml(a.category) + (a.type ? '<span class="cell-time">' + escapeHtml(a.type) + '</span>' : '') + '</td>' +
      '<td>' + escapeHtml(a.location) + (a.assignedTo ? '<span class="cell-time">' + escapeHtml(a.assignedTo) + '</span>' : '') + '</td>' +
      '<td>' + assetStatusTag(a.status) + (a.transfer ? '<span class="cell-time">to ' + escapeHtml(a.transfer.to) + '</span>' : '') + '</td>' +
      '<td>' + escapeHtml(a.condition || '—') + '</td>' +
      '<td class="nowrap asset-val-col">' + (a.value === null ? '—' : rand(a.value)) + '</td>' +
    '</tr>').join('');
  document.getElementById('assetEmpty').hidden = list.length > 0;
  document.getElementById('assetEmpty').textContent = d.assets.length ? 'No assets match.' : (d.canEdit ? 'No assets yet — use + Add asset to start the register.' : 'No assets have been recorded for your branch yet.');
  const heldTotal = d.assets.filter(assetHeld).length;
  document.getElementById('assetCount').textContent = 'Showing ' + list.length + ' of ' + d.assets.length + (d.assets.length - heldTotal ? ' · ' + (d.assets.length - heldTotal) + ' no longer held' : '');
}

function renderAssetCategories() {
  const d = assetData;
  const used = {};
  d.assets.forEach((a) => { used[a.categoryId] = (used[a.categoryId] || 0) + 1; });
  document.getElementById('assetCatList').innerHTML = d.groups.map((g) => {
    const cats = d.categories.filter((c) => c.group === g);
    if (!cats.length) return '';
    return '<h2 class="asset-cat-group">' + escapeHtml(g) + '</h2>' + cats.map((c) =>
      '<div class="fin-cat' + (c.active ? '' : ' is-hidden') + '">' +
        '<div class="fin-cat-head"><strong>' + escapeHtml(c.name) + '</strong>' + (c.active ? '' : ' <span class="status-tag as-gone">Hidden</span>') +
          '<span class="muted asset-cat-used">' + (used[c.id] || 0) + ' asset' + (used[c.id] === 1 ? '' : 's') + '</span>' +
          '<button type="button" class="link-btn" data-asset-cat-edit="' + escapeAttr(c.id) + '">Edit</button></div>' +
        '<p class="muted fin-cat-note">' + (c.types.length ? escapeHtml(c.types.join(', ')) : 'No suggested types') + '</p>' +
        '<p class="muted fin-cat-note">Useful life: ' + c.usefulLife + ' years</p>' +
      '</div>').join('');
  }).join('');
}

// ── Detail window ───────────────────────────────────────────────────

async function openAssetDetail(id) {
  assetOpen = null;
  document.getElementById('assetDetailId').textContent = id;
  document.getElementById('assetDetailTitle').textContent = 'Loading…';
  document.getElementById('assetDetailSubtitle').textContent = '';
  document.getElementById('assetDetailBody').innerHTML = '<p class="muted">Opening…</p>';
  document.getElementById('assetDetailBackdrop').hidden = false;
  const res = await apiGet('asset', { email: currentUser.email, id: id });
  if (document.getElementById('assetDetailBackdrop').hidden) return;
  if (!res.success) {
    document.getElementById('assetDetailTitle').textContent = 'Asset';
    document.getElementById('assetDetailBody').innerHTML = '<p class="error-text">' + escapeHtml(res.error || 'Could not open the asset.') + '</p>';
    return;
  }
  assetOpen = res;
  renderAssetDetail();
}

function renderAssetDetail() {
  const a = assetOpen.asset;
  const d = assetData;
  document.getElementById('assetDetailId').textContent = a.id;
  document.getElementById('assetDetailTitle').textContent = a.name;
  document.getElementById('assetDetailSubtitle').textContent = a.category + (a.type ? ' · ' + a.type : '');
  const donated = a.acquired === 'Donated';
  const row = (label, value) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + (value || '—') + '</dd></div>';
  const fields = [
    row('Status', assetStatusTag(a.status)), row('Condition', escapeHtml(a.condition)),
    row('Location', escapeHtml(a.location)), row('Department', escapeHtml(a.department)),
    row('Assigned to', escapeHtml(a.assignedTo) + (a.assignedTo && a.assignedSince ? '<span class="muted"> · since ' + escapeHtml(assetWhen(a.assignedSince)) + '</span>' : '')),
    row('Serial number', escapeHtml(a.serial)),
    row('Acquired', escapeHtml(a.acquired) + (a.acquiredDate ? ' · ' + escapeHtml(assetWhen(a.acquiredDate)) : ''))
  ];
  if (d.canEdit) {
    fields.push(row(donated ? 'Estimated value' : 'Purchase value', a.value === null ? '' : rand(a.value)));
    fields.push(row(donated ? 'Donated by' : 'Supplier', escapeHtml(a.supplier)));
    fields.push(row('Book value today', a.bookValue === null ? '<span class="muted">' + (a.value === null ? 'No value' : 'Add the date acquired') + '</span>' : rand(a.bookValue)));
    fields.push(row('Useful life', a.life + ' years' + (a.usefulLife ? '' : ' <span class="muted">(category)</span>')));
  }
  fields.push(row('Last verified', a.lastVerified ? escapeHtml(assetWhen(a.lastVerified)) : ''));
  fields.push(row('Warranty until', a.warrantyUntil ? escapeHtml(assetWhen(a.warrantyUntil)) : ''));
  fields.push(row('Next service due', a.nextServiceDue ? escapeHtml(assetWhen(a.nextServiceDue)) : ''));
  const held = assetHeld(a);
  let html = disposalBanner(a);
  if (a.transfer) {
    const t = a.transfer;
    html += '<div class="asset-transit-banner"><strong>On its way: ' + escapeHtml(t.from) + ' → ' + escapeHtml(t.to) + '</strong>' +
      '<p class="muted">' + escapeHtml(t.id) + ' · sent ' + escapeHtml(assetWhen(t.startedAt)) + ' by ' + escapeHtml(t.startedBy) +
      (t.takenBy ? ' · taken by ' + escapeHtml(t.takenBy) : '') + '</p>' + (t.reason ? '<p>' + escapeHtml(t.reason) + '</p>' : '') +
      '<div class="asset-actions">' + (assetOpen.canReceive ? '<button type="button" class="btn-primary" id="assetReceiveBtn">Confirm it arrived</button>' : '') +
      (d.canEdit || t.from === d.branch ? '<button type="button" class="btn-secondary" id="assetCancelTrBtn">Cancel transfer</button>' : '') + '</div></div>';
  }
  if (a.report) {
    html += '<div class="asset-report-banner"><strong>Problem reported: ' + escapeHtml(a.report.type) + '</strong>' +
      '<p>' + escapeHtml(a.report.note) + '</p><p class="muted">' + escapeHtml(a.report.by) + ' · ' + escapeHtml(assetWhen(a.report.at)) + '</p>' +
      (d.canEdit ? '<button type="button" class="btn-secondary" id="assetCloseReportBtn">Mark as dealt with…</button>' : '<p class="muted">Head Office has been told.</p>') + '</div>';
  }
  html += '<dl class="asset-fields">' + fields.join('') + '</dl>';
  if (a.notes) html += '<p class="asset-notes"><strong>Notes</strong><br>' + escapeHtml(a.notes).replace(/\n/g, '<br>') + '</p>';
  const can = assetOpen.canHandle && held;
  html += '<div class="asset-actions">' +
    (d.canEdit ? '<button type="button" class="btn-primary" id="assetEditBtn">Edit</button>' : '') +
    (can && !a.transfer && !a.pendingDisposal ? '<button type="button" class="btn-secondary" id="assetTransferBtn">Transfer</button>' : '') +
    (can ? '<button type="button" class="btn-secondary" id="assetAssignBtn">' + (a.assignedTo ? 'Reassign' : 'Assign') + '</button>' : '') +
    (can && a.assignedTo ? '<button type="button" class="btn-secondary" id="assetReturnBtn">Return</button>' : '') +
    (d.canEdit && held ? '<button type="button" class="btn-secondary" id="assetMaintBtn">Log maintenance</button>' : '') +
    (d.canEdit && held && !a.transfer && !a.pendingDisposal ? '<button type="button" class="btn-secondary asset-dispose-btn" id="assetDisposeBtn">Dispose…</button>' : '') +
    (!a.report && !d.canEdit && held ? '<button type="button" class="btn-secondary" id="assetReportBtn">Report a problem</button>' : '') + '</div>';

  html += '<h3 class="asset-sub">Files</h3>';
  html += assetOpen.files.length ? '<ul class="asset-files">' + assetOpen.files.map((f) =>
    '<li>' + fileButton(f.file, f.kind + ': ' + f.name) + '<span class="muted"> · ' + escapeHtml(assetWhen(f.at).slice(0, 10)) + '</span>' +
    (d.canEdit ? ' <button type="button" class="link-btn asset-file-rm" data-asset-file-rm="' + escapeAttr(f.id) + '">Remove</button>' : '') + '</li>').join('') + '</ul>'
    : '<p class="muted">' + (d.canEdit ? 'No photos or documents yet.' : 'No photos yet.') + '</p>';
  if (d.canEdit) {
    html += '<div class="asset-file-add"><select id="adFileKind">' + d.fileKinds.map((k) => '<option>' + escapeHtml(k) + '</option>').join('') + '</select>' +
      '<input type="file" id="adFile" accept="image/*,application/pdf"><button type="button" class="btn-secondary" id="adFileUpload" disabled>Upload</button></div>' +
      '<p class="error-text" id="adFileError"></p>';
  }
  html += '<h3 class="asset-sub">Maintenance &amp; repairs</h3>' + (assetOpen.maintenance && assetOpen.maintenance.length
    ? assetOpen.maintenance.map((m) => assetMaintLine(m, false)).join('') : '<p class="muted">No maintenance recorded.</p>');
  html += '<h3 class="asset-sub">History</h3><ol class="asset-history">' + assetOpen.history.map((h) =>
    '<li><span class="asset-h-when">' + escapeHtml(assetWhen(h.at)) + '</span><span class="asset-h-what"><strong>' + escapeHtml(h.event) + '</strong>' +
    (h.details ? ' — ' + escapeHtml(h.details) : '') + '</span><span class="muted asset-h-who">' + escapeHtml(h.by) + '</span></li>').join('') + '</ol>';
  document.getElementById('assetDetailBody').innerHTML = html;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('assetEditBtn', () => openAssetEdit(assetOpen.asset));
  on('assetReportBtn', () => openAssetReport('report'));
  on('assetCloseReportBtn', () => openAssetReport('close'));
  on('assetTransferBtn', openAssetTransfer);
  on('assetReceiveBtn', openAssetReceive);
  on('assetCancelTrBtn', openAssetCancelTransfer);
  on('assetAssignBtn', openAssetAssign);
  on('assetReturnBtn', openAssetReturn);
  on('assetMaintBtn', openAssetMaintenance);
  on('assetDisposeBtn', openAssetDispose);
  on('assetDpApprove', () => openAssetDisposalDecision('approve'));
  on('assetDpReject', () => openAssetDisposalDecision('reject'));
  on('assetDpCancel', () => openAssetDisposalDecision('cancel'));
  document.querySelectorAll('#assetDetailBody [data-maint-rm]').forEach((b) => b.addEventListener('click', () => removeAssetMaint(b)));
  const fileIn = document.getElementById('adFile');
  if (fileIn) {
    let data = '';
    fileIn.addEventListener('change', async () => {
      document.getElementById('adFileError').textContent = '';
      document.getElementById('adFileUpload').disabled = true;
      try { data = await readAssetFile(fileIn.files[0], true); } catch (ex) { document.getElementById('adFileError').textContent = ex.message; fileIn.value = ''; return; }
      document.getElementById('adFileUpload').disabled = !data;
    });
    on('adFileUpload', async () => {
      const btn = document.getElementById('adFileUpload');
      const f = fileIn.files[0];
      btn.disabled = true; btn.textContent = 'Uploading…';
      const res = await apiPost('assetFile', { requesterEmail: currentUser.email, id: a.id,
        file: { kind: document.getElementById('adFileKind').value, name: f ? f.name.replace(/\.[^.]+$/, '') : '', data: data } });
      btn.textContent = 'Upload';
      if (!res.success) { btn.disabled = false; document.getElementById('adFileError').textContent = res.error || 'Could not upload.'; return; }
      openAssetDetail(a.id);
    });
  }
  document.querySelectorAll('[data-asset-file-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to remove'; return; }
    b.disabled = true;
    const res = await apiPost('assetFile', { requesterEmail: currentUser.email, op: 'remove', fileId: b.dataset.assetFileRm });
    if (!res.success) { b.disabled = false; b.textContent = res.error || 'Could not remove'; return; }
    openAssetDetail(a.id);
  }));
}

function closeAssetDetail() { document.getElementById('assetDetailBackdrop').hidden = true; assetOpen = null; }

// Photos are shrunk in the browser; PDFs up to 5 MB go as they are.
async function readAssetFile(file, allowPdf) {
  if (!file) return '';
  if (allowPdf && file.type === 'application/pdf') {
    if (file.size > 5 * 1024 * 1024) throw new Error('That PDF is too large (max 5 MB).');
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read that file.'));
      r.readAsDataURL(file);
    });
  }
  if (file.type.startsWith('image/')) return resizeImageFileToDataUrl(file, PROOF_MAX_DIMENSION, PROOF_JPEG_QUALITY);
  throw new Error(allowPdf ? 'Choose a photo or a PDF.' : 'Choose a photo.');
}

// ── Add / edit ──────────────────────────────────────────────────────

function openAssetEdit(asset) {
  const d = assetData;
  assetEditing = asset || null;
  assetFileData = '';
  const sel = (id, list, value) => {
    document.getElementById(id).innerHTML = list.map((x) => '<option value="' + escapeAttr(x.value) + '">' + escapeHtml(x.label) + '</option>').join('');
    document.getElementById(id).value = value;
  };
  document.getElementById('assetEditTitle').textContent = asset ? 'Edit ' + asset.id : 'Add asset';
  document.getElementById('assetInvNote').hidden = !!asset;
  const cats = d.categories.filter((c) => c.active || (asset && asset.categoryId === c.id));
  document.getElementById('aeCategory').innerHTML = '<option value="">Choose…</option>' + d.groups.map((g) => {
    const inG = cats.filter((c) => c.group === g);
    return inG.length ? '<optgroup label="' + escapeAttr(g) + '">' + inG.map((c) => '<option value="' + escapeAttr(c.id) + '">' + escapeHtml(c.name) + '</option>').join('') + '</optgroup>' : '';
  }).join('');
  document.getElementById('aeCategory').value = asset ? asset.categoryId : '';
  const defaultLoc = d.locations.indexOf(document.getElementById('assetLocFilter').value) !== -1 ? document.getElementById('assetLocFilter').value : d.locations[0];
  sel('aeLocation', d.locations.map((x) => ({ value: x, label: x })), asset ? asset.location : defaultLoc);
  const gone = !!(asset && d.gone.indexOf(asset.status) !== -1);
  sel('aeStatus', d.statuses.filter((s) => (gone ? s.key === asset.status : d.gone.indexOf(s.key) === -1)).map((s) => ({ value: s.key, label: s.key })), asset ? asset.status : 'In Use');
  sel('aeCondition', d.conditions.map((x) => ({ value: x, label: x })), asset ? asset.condition : 'Good');
  sel('aeAcquired', d.acquired.map((x) => ({ value: x, label: x === 'Donated' ? 'Donated (for the charity to use)' : x })), asset ? asset.acquired : 'Purchased');
  sel('aeFileKind', d.fileKinds.map((x) => ({ value: x, label: x })), 'Photo');
  document.getElementById('aeDeptList').innerHTML = d.departments.map((x) => '<option value="' + escapeAttr(x) + '">').join('');
  const v = (id, val) => { document.getElementById(id).value = val === null || val === undefined ? '' : val; };
  v('aeName', asset && asset.name); v('aeType', asset && asset.type); v('aeDepartment', asset && asset.department);
  v('aeDate', asset && asset.acquiredDate); v('aeValue', asset && asset.value); v('aeSupplier', asset && asset.supplier);
  v('aeSerial', asset && asset.serial); v('aeAssigned', asset && asset.assignedTo); v('aeWarranty', asset && asset.warrantyUntil);
  v('aeNotes', asset && asset.notes); v('aeReason', ''); v('aeFile', ''); v('aeNextService', asset && asset.nextServiceDue);
  document.getElementById('aeAssignedWrap').hidden = !!asset; // after adding, use Assign / Return on the asset
  document.getElementById('aePeopleList').innerHTML = (d.people || []).map((x) => '<option value="' + escapeAttr(x) + '">').join('');
  const inTransit = !!(asset && asset.transfer);
  document.getElementById('aeLocation').disabled = inTransit;
  document.getElementById('aeStatus').disabled = inTransit || gone || !!(asset && asset.pendingDisposal);
  v('aeLife', asset && asset.usefulLife);
  document.getElementById('aeFileWrap').hidden = !!asset; // on an existing asset, files are added in its window
  document.getElementById('assetEditError').textContent = '';
  document.getElementById('assetEditSave').disabled = false;
  document.getElementById('assetEditSave').textContent = 'Save';
  onAssetCategoryChange(); onAssetStatusChange(); onAssetAcquiredChange();
  document.getElementById('assetEditBackdrop').hidden = false;
  if (!asset) setTimeout(() => document.getElementById('aeName').focus(), 50);
}

function onAssetCategoryChange() {
  const c = assetData.categories.filter((x) => x.id === document.getElementById('aeCategory').value)[0];
  document.getElementById('aeTypeList').innerHTML = (c ? c.types : []).map((t) => '<option value="' + escapeAttr(t) + '">').join('');
  document.getElementById('aeLife').placeholder = c ? 'Category default: ' + c.usefulLife : '';
}
function onAssetStatusChange() {
  const st = document.getElementById('aeStatus').value;
  const s = assetData.statuses.filter((x) => x.key === st)[0];
  document.getElementById('aeStatusHint').textContent = s ? st + ': ' + s.meaning.toLowerCase() + '.' : '';
  const changed = !assetEditing || assetEditing.status !== st;
  const needed = assetData.reasonNeeded.indexOf(st) !== -1 && changed;
  document.getElementById('aeReasonWrap').hidden = !(needed || (assetEditing && changed));
  document.getElementById('aeReasonLabel').textContent = needed ? 'Why is it ' + st.toLowerCase() + '? (shows in the history)' : 'Note for the history (optional)';
}
function onAssetAcquiredChange() {
  const donated = document.getElementById('aeAcquired').value === 'Donated';
  document.getElementById('aeDateLabel').textContent = donated ? 'Date received' : 'Purchase date';
  document.getElementById('aeValueLabel').textContent = donated ? 'Estimated value (R)' : 'Purchase value (R)';
  document.getElementById('aeSupplierLabel').textContent = donated ? 'Donated by' : 'Supplier';
}

async function saveAssetEdit() {
  const err = document.getElementById('assetEditError');
  const btn = document.getElementById('assetEditSave');
  err.textContent = '';
  const g = (id) => document.getElementById(id).value;
  const asset = {
    name: g('aeName').trim(), categoryId: g('aeCategory'), type: g('aeType').trim(), location: g('aeLocation'),
    department: g('aeDepartment').trim(), status: g('aeStatus'), condition: g('aeCondition'), acquired: g('aeAcquired'),
    acquiredDate: g('aeDate'), value: g('aeValue'), supplier: g('aeSupplier').trim(), serial: g('aeSerial').trim(),
    assignedTo: g('aeAssigned').trim(), warrantyUntil: g('aeWarranty'), notes: g('aeNotes').trim(), nextServiceDue: g('aeNextService'),
    usefulLife: g('aeLife')
  };
  if (!asset.name) { err.textContent = 'Give the asset a name.'; return; }
  if (!asset.categoryId) { err.textContent = 'Choose a category.'; return; }
  const reason = document.getElementById('aeReasonWrap').hidden ? '' : g('aeReason').trim();
  const changed = !assetEditing || assetEditing.status !== asset.status;
  if (changed && assetData.reasonNeeded.indexOf(asset.status) !== -1 && !reason) { err.textContent = 'Add a note explaining why it is ' + asset.status.toLowerCase() + '.'; return; }
  const payload = { requesterEmail: currentUser.email, asset: asset, reason: reason };
  if (assetEditing) { asset.id = assetEditing.id; payload.version = assetEditing.version; }
  else {
    payload.requestId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    if (assetFileData) {
      const f = document.getElementById('aeFile').files[0];
      payload.file = { kind: g('aeFileKind'), name: f ? f.name.replace(/\.[^.]+$/, '') : '', data: assetFileData };
    }
  }
  btn.disabled = true; btn.textContent = payload.file ? 'Uploading…' : 'Saving…';
  const res = await apiPost('assetSave', payload);
  btn.disabled = false; btn.textContent = 'Save';
  if (!res.success) { err.textContent = res.error || 'Could not save.'; return; }
  document.getElementById('assetEditBackdrop').hidden = true;
  const id = res.id;
  const wasNew = !assetEditing;
  assetEditing = null;
  await loadAssetsPage();
  if (wasNew && assetTab !== 'register') showAssetTab('register');
  if (res.warning) alertAssetNotice(res.warning);
  openAssetDetail(id);
}

function alertAssetNotice(msg) {
  const el = document.getElementById('assetError');
  el.textContent = msg; el.hidden = false;
}

// ── Report a problem / close a report ───────────────────────────────

function openAssetReport(mode) {
  const a = assetOpen && assetOpen.asset;
  if (!a) return;
  assetReportMode = mode;
  assetReportPhoto = '';
  const closing = mode === 'close';
  document.getElementById('assetReportTitle').textContent = closing ? 'Mark as dealt with' : 'Report a problem';
  document.getElementById('assetReportSubtitle').textContent = a.id + ' · ' + a.name;
  document.getElementById('arTypeWrap').hidden = closing;
  document.getElementById('arPhotoWrap').hidden = closing;
  document.getElementById('arStatusWrap').hidden = !closing;
  document.getElementById('arType').innerHTML = assetData.reportTypes.map((t) => '<option>' + escapeHtml(t) + '</option>').join('');
  document.getElementById('arStatus').innerHTML = assetData.statuses.filter((s) => assetData.gone.indexOf(s.key) === -1 && (s.key !== 'Transferred' || a.status === 'Transferred')).map((s) => '<option value="' + escapeAttr(s.key) + '">' + escapeHtml(s.key) + '</option>').join('');
  document.getElementById('arStatus').value = a.status;
  document.getElementById('arNoteLabel').textContent = closing ? 'What was done?' : 'What happened?';
  document.getElementById('arHint').textContent = closing
    ? 'Reported: ' + a.report.type + ' — ' + a.report.note + ' (' + a.report.by + ')'
    : 'Admin and Back Office are emailed straight away. It stays on the asset until they deal with it.';
  document.getElementById('arNote').value = '';
  document.getElementById('arPhoto').value = '';
  document.getElementById('assetReportError').textContent = '';
  document.getElementById('assetReportSave').textContent = closing ? 'Save' : 'Send report';
  document.getElementById('assetReportSave').disabled = false;
  document.getElementById('assetReportBackdrop').hidden = false;
}

async function saveAssetReport() {
  const a = assetOpen && assetOpen.asset;
  const err = document.getElementById('assetReportError');
  const btn = document.getElementById('assetReportSave');
  err.textContent = '';
  const note = document.getElementById('arNote').value.trim();
  if (!note) { err.textContent = assetReportMode === 'close' ? 'Add a short note on what was done.' : 'Describe what happened.'; return; }
  const closing = assetReportMode === 'close';
  const payload = closing
    ? { requesterEmail: currentUser.email, id: a.id, note: note, status: document.getElementById('arStatus').value }
    : { requesterEmail: currentUser.email, id: a.id, type: document.getElementById('arType').value, note: note, photo: assetReportPhoto || '' };
  btn.disabled = true; btn.textContent = assetReportPhoto ? 'Uploading…' : 'Sending…';
  const res = await apiPost(closing ? 'assetReportClose' : 'assetReport', payload);
  btn.disabled = false; btn.textContent = closing ? 'Save' : 'Send report';
  if (!res.success) { err.textContent = res.error || 'Could not save.'; return; }
  document.getElementById('assetReportBackdrop').hidden = true;
  await loadAssetsPage();
  if (res.warning) alertAssetNotice(res.warning);
  openAssetDetail(a.id);
}

// ── Categories (Admins) ─────────────────────────────────────────────


// ── Stage 2: one small form for transfer, receive, assign, maintenance ──
let assetForm = null; // { fields, submit(values) -> Promise<res> }

// fields: [{ id, label, type: text|textarea|select|date|number|file|radio, options:[{value,label}], value, hint, list, required, half }]
function openAssetForm(spec) {
  assetForm = spec;
  document.getElementById('assetFormTitle').textContent = spec.title;
  document.getElementById('assetFormSubtitle').textContent = spec.subtitle || '';
  const wrap = document.getElementById('assetFormFields');
  wrap.innerHTML = spec.intro ? '<p class="muted asset-form-intro">' + escapeHtml(spec.intro) + '</p>' : '';
  let grid = null;
  spec.fields.forEach((f) => {
    const id = 'af_' + f.id;
    let input;
    if (f.type === 'select') {
      input = '<select id="' + id + '">' + f.options.map((o) => '<option value="' + escapeAttr(o.value) + '">' + escapeHtml(o.label) + '</option>').join('') + '</select>';
    } else if (f.type === 'textarea') {
      input = '<textarea id="' + id + '" rows="3" maxlength="' + (f.max || 300) + '"></textarea>';
    } else if (f.type === 'radio') {
      input = '<div class="asset-radios">' + f.options.map((o, i) => '<label class="fin-check"><input type="radio" name="' + id + '" value="' + escapeAttr(o.value) + '"' +
        (i === 0 ? ' checked' : '') + '> ' + escapeHtml(o.label) + '</label>').join('') + '</div>';
    } else if (f.type === 'file') {
      input = '<input type="file" id="' + id + '" accept="image/*,application/pdf">';
    } else {
      input = '<input type="' + (f.type === 'number' ? 'number' : f.type || 'text') + '" id="' + id + '"' +
        (f.type === 'number' ? ' step="0.01" min="0" inputmode="decimal"' : ' maxlength="' + (f.max || 120) + '"') +
        (f.list ? ' list="' + id + '_list"' : '') + (f.placeholder ? ' placeholder="' + escapeAttr(f.placeholder) + '"' : '') + '>' +
        (f.list ? '<datalist id="' + id + '_list">' + f.list.map((x) => '<option value="' + escapeAttr(x) + '">').join('') + '</datalist>' : '');
    }
    const html = f.type === 'radio'
      ? '<div class="asset-field" id="' + id + '_wrap"><span class="asset-field-label">' + escapeHtml(f.label) + '</span>' + input + '</div>'
      : '<label id="' + id + '_wrap"><span id="' + id + '_label">' + escapeHtml(f.label) + '</span> ' + input + '</label>';
    const holder = document.createElement('div');
    holder.innerHTML = html;
    if (f.half) {
      if (!grid) { grid = document.createElement('div'); grid.className = 'grid-2'; wrap.appendChild(grid); }
      while (holder.firstChild) grid.appendChild(holder.firstChild);
    } else {
      grid = null;
      while (holder.firstChild) wrap.appendChild(holder.firstChild);
    }
    const el = document.getElementById(id);
    if (el && f.value !== undefined && f.value !== null && f.type !== 'file') el.value = f.value;
  });
  spec.fields.filter((f) => f.type === 'file').forEach((f) => {
    f.data = '';
    const el = document.getElementById('af_' + f.id);
    el.addEventListener('change', async () => {
      f.data = ''; document.getElementById('assetFormError').textContent = '';
      try { f.data = await readAssetFile(el.files[0], true); f.name = el.files[0] ? el.files[0].name.replace(/\.[^.]+$/, '') : ''; }
      catch (ex) { document.getElementById('assetFormError').textContent = ex.message; el.value = ''; }
    });
  });
  if (spec.onRender) spec.onRender();
  document.getElementById('assetFormError').textContent = '';
  document.getElementById('assetFormSave').textContent = spec.submitLabel || 'Save';
  document.getElementById('assetFormSave').disabled = false;
  document.getElementById('assetFormBackdrop').hidden = false;
}

function assetFormValues() {
  const out = {};
  assetForm.fields.forEach((f) => {
    if (f.type === 'radio') { const c = document.querySelector('input[name="af_' + f.id + '"]:checked'); out[f.id] = c ? c.value : ''; }
    else if (f.type === 'file') out[f.id] = f.data ? { name: f.name, data: f.data } : null;
    else out[f.id] = document.getElementById('af_' + f.id).value.trim();
  });
  return out;
}

async function submitAssetForm() {
  const err = document.getElementById('assetFormError');
  const btn = document.getElementById('assetFormSave');
  err.textContent = '';
  const vals = assetFormValues();
  const missing = assetForm.fields.filter((f) => (typeof f.required === 'function' ? f.required(vals) : f.required) && !vals[f.id])[0];
  if (missing) { err.textContent = missing.requiredText || 'Fill in ' + missing.label.toLowerCase() + '.'; return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  const res = await assetForm.submit(vals);
  btn.disabled = false; btn.textContent = label;
  if (!res.success) { err.textContent = res.error || 'Could not save.'; return; }
  document.getElementById('assetFormBackdrop').hidden = true;
  const id = assetOpen && assetOpen.asset.id;
  await loadAssetsPage();
  if (res.warning) alertAssetNotice(res.warning);
  if (id && !document.getElementById('assetDetailBackdrop').hidden) openAssetDetail(id);
}

const assetSub = () => assetOpen.asset.id + ' · ' + assetOpen.asset.name;
const assetPost = (action, extra) => apiPost(action, Object.assign({ requesterEmail: currentUser.email, id: assetOpen.asset.id }, extra));

function openAssetTransfer() {
  const a = assetOpen.asset;
  const dests = assetData.allLocations.filter((l) => l !== a.location);
  openAssetForm({
    title: 'Transfer', subtitle: assetSub(), submitLabel: 'Send',
    intro: 'From ' + a.location + '. It shows as "Transferred" until the receiving location confirms it arrived, and they get an email.',
    fields: [
      { id: 'to', label: 'Sending it to', type: 'select', options: [{ value: '', label: 'Choose…' }].concat(dests.map((l) => ({ value: l, label: l }))),
        required: true, requiredText: 'Choose where it is going.' },
      { id: 'takenBy', label: 'Taken by (optional)', placeholder: 'e.g. the driver', list: assetData.people },
      { id: 'reason', label: 'Reason (optional)', type: 'textarea' }
    ],
    submit: (v) => assetPost('assetTransfer', { to: v.to, takenBy: v.takenBy, reason: v.reason })
  });
}

function openAssetReceive() {
  const t = assetOpen.asset.transfer;
  openAssetForm({
    title: 'Confirm it arrived', subtitle: assetSub(), submitLabel: 'Confirm',
    intro: t.from + ' → ' + t.to + ', sent ' + assetWhen(t.startedAt) + ' by ' + t.startedBy + '.',
    fields: [
      { id: 'outcome', label: 'How did it arrive?', type: 'radio', options: [{ value: 'ok', label: 'In good order' }, { value: 'damaged', label: 'Damaged' }] },
      { id: 'note', label: 'Note (optional)', type: 'textarea', required: (v) => v.outcome === 'damaged', requiredText: 'Describe the damage.' }
    ],
    onRender: () => document.querySelectorAll('input[name="af_outcome"]').forEach((r) => r.addEventListener('change', () => {
      const dmg = document.querySelector('input[name="af_outcome"]:checked').value === 'damaged';
      document.getElementById('af_note_label').textContent = dmg ? 'What is damaged?' : 'Note (optional)';
    })),
    submit: (v) => assetPost('assetTransferFinish', { outcome: v.outcome, note: v.note })
  });
}

function openAssetCancelTransfer() {
  const t = assetOpen.asset.transfer;
  openAssetForm({
    title: 'Cancel transfer', subtitle: assetSub(), submitLabel: 'Cancel transfer',
    intro: 'It stays at ' + t.from + ' and goes back to its previous status.',
    fields: [{ id: 'note', label: 'Why? (optional)', type: 'textarea' }],
    submit: (v) => assetPost('assetTransferFinish', { op: 'cancel', note: v.note })
  });
}

function openAssetAssign() {
  const a = assetOpen.asset;
  openAssetForm({
    title: a.assignedTo ? 'Reassign' : 'Assign to a person', subtitle: assetSub(), submitLabel: 'Assign',
    intro: a.assignedTo ? 'Currently with ' + a.assignedTo + '.' : (a.status === 'Available' ? 'Its status will change to In Use.' : ''),
    fields: [
      { id: 'person', label: 'Person', list: assetData.people, placeholder: 'Name, or a role like "Till 2"', required: true, requiredText: 'Who is it assigned to?' },
      { id: 'since', label: 'From', type: 'date', value: assetData.today },
      { id: 'note', label: 'Note (optional)', type: 'textarea' }
    ],
    submit: (v) => assetPost('assetAssign', { person: v.person, since: v.since, note: v.note })
  });
}

function openAssetReturn() {
  const a = assetOpen.asset;
  openAssetForm({
    title: 'Return', subtitle: assetSub(), submitLabel: 'Return',
    intro: 'Back from ' + a.assignedTo + '.' + (a.status === 'In Use' ? ' Its status will change to Available.' : ''),
    fields: [{ id: 'note', label: 'Note (optional)', type: 'textarea' }],
    submit: (v) => assetPost('assetAssign', { op: 'return', note: v.note })
  });
}

function openAssetMaintenance() {
  const a = assetOpen.asset;
  const requestId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const statuses = assetData.statuses.filter((s) => assetData.gone.indexOf(s.key) === -1 && s.key !== 'Transferred');
  openAssetForm({
    title: 'Log maintenance', subtitle: assetSub(), submitLabel: 'Save',
    fields: [
      { id: 'type', label: 'Type of work', type: 'select', half: true, options: assetData.maintenanceTypes.map((t) => ({ value: t, label: t })) },
      { id: 'date', label: 'Date done', type: 'date', half: true, value: assetData.today, required: true, requiredText: 'When was the work done?' },
      { id: 'description', label: 'What was done', type: 'textarea', max: 500, required: true, requiredText: 'Describe the work that was done.' },
      { id: 'provider', label: 'Done by (optional)', half: true, placeholder: 'Company or person' },
      { id: 'cost', label: 'Cost (R, optional)', type: 'number', half: true },
      { id: 'nextDue', label: 'Next service due (optional)', type: 'date', half: true, value: a.nextServiceDue },
      { id: 'status', label: 'Status after this', type: 'select', half: true, options: statuses.map((s) => ({ value: s.key, label: s.key })),
        value: a.status === 'Under Maintenance' || a.status === 'Damaged' ? 'In Use' : a.status },
      { id: 'file', label: 'Job card or invoice (photo or PDF, optional)', type: 'file' }
    ],
    onRender: () => {
      if (a.transfer) { const st = document.getElementById('af_status'); st.innerHTML = '<option>' + escapeHtml(a.status) + '</option>'; st.disabled = true; }
    },
    submit: (v) => assetPost('assetMaintenance', { requestId: requestId, type: v.type, date: v.date, description: v.description, provider: v.provider,
      cost: v.cost, nextDue: v.nextDue, status: a.transfer ? '' : v.status, file: v.file })
  });
}

async function removeAssetMaint(b) {
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to remove'; return; }
  b.disabled = true;
  const res = await apiPost('assetMaintenance', { requesterEmail: currentUser.email, op: 'remove', recordId: b.dataset.maintRm });
  if (!res.success) { b.disabled = false; b.textContent = res.error || 'Could not remove'; return; }
  const id = assetOpen && assetOpen.asset.id;
  await loadAssetsPage();
  if (id) openAssetDetail(id);
}

function assetMaintLine(m, withAsset) {
  const a = withAsset ? assetData.assets.filter((x) => x.id === m.assetId)[0] : null;
  return '<div class="fin-line asset-maint-line">' +
    '<span class="fin-line-main"><span class="fin-line-desc">' +
      (withAsset ? '<button type="button" class="link-btn asset-link" data-asset="' + escapeAttr(m.assetId) + '">' +
        escapeHtml(m.assetId + (a ? ' · ' + a.name : '')) + '</button> — ' : '') + escapeHtml(m.type) + ': ' + escapeHtml(m.description) + '</span>' +
    '<span class="fin-line-meta">' + escapeHtml(assetWhen(m.date)) + (m.provider ? ' · ' + escapeHtml(m.provider) : '') +
      (m.nextDue ? ' · next due ' + escapeHtml(assetWhen(m.nextDue)) : '') + '</span>' +
      (m.file ? '<span>' + fileButton(m.file, 'Job card / invoice') + '</span>' : '') + '</span>' +
    '<span class="fin-line-side">' + (m.cost !== null ? '<span class="fin-line-amt">' + rand(m.cost) + '</span>' : '') +
      (!withAsset && assetData.canEdit ? '<button type="button" class="link-btn asset-file-rm" data-maint-rm="' + escapeAttr(m.id) + '">Remove</button>' : '') + '</span>' +
  '</div>';
}

function renderAssetTransfers() {
  const d = assetData;
  const name = (id) => { const a = d.assets.filter((x) => x.id === id)[0]; return a ? a.name : ''; };
  const line = (t, open) => '<div class="fin-line">' +
    '<span class="fin-line-main"><span class="fin-line-desc"><button type="button" class="link-btn asset-link" data-asset="' + escapeAttr(t.assetId) + '">' +
      escapeHtml(t.assetId + (name(t.assetId) ? ' · ' + name(t.assetId) : '')) + '</button></span>' +
    '<span class="fin-line-meta"><strong>' + escapeHtml(t.from) + ' → ' + escapeHtml(t.to) + '</strong> · ' + escapeHtml(t.id) + ' · sent ' +
      escapeHtml(assetWhen(t.startedAt)) + ' by ' + escapeHtml(t.startedBy) + (t.takenBy ? ' · taken by ' + escapeHtml(t.takenBy) : '') + '</span>' +
    (!open ? '<span class="fin-line-meta">' + escapeHtml(t.outcome || t.status) + ' · ' + escapeHtml(assetWhen(t.closedAt)) + ' · ' + escapeHtml(t.closedBy) +
      (t.closeNote ? ' — ' + escapeHtml(t.closeNote) : '') + '</span>' : '') + '</span>' +
    '<span class="fin-line-side">' + (open
      ? (t.to === d.branch ? '<button type="button" class="btn-primary asset-tr-btn" data-asset="' + escapeAttr(t.assetId) + '">Confirm arrival</button>'
        : '<span class="status-tag as-info">On the way</span>')
      : '<span class="status-tag ' + (t.status === 'Received' ? (t.outcome === 'Arrived damaged' ? 'as-bad' : 'as-ok') : 'as-gone') + '">' + escapeHtml(t.status) + '</span>') +
    '</span></div>';
  const open = d.transfers.filter((t) => t.status === 'In transit');
  const done = d.transfers.filter((t) => t.status !== 'In transit');
  document.getElementById('assetTrOpen').innerHTML = open.length ? open.map((t) => line(t, true)).join('') : '<p class="muted">Nothing is on the way.</p>';
  document.getElementById('assetTrDone').innerHTML = done.length ? done.map((t) => line(t, false)).join('') : '<p class="muted">None.</p>';
}

function renderAssetMaintenance() {
  const d = assetData;
  const month = d.today.slice(0, 7), year = d.today.slice(0, 4);
  const sum = (list) => list.reduce((t, m) => t + (m.cost || 0), 0);
  document.getElementById('assetMtMonth').textContent = rand(sum(d.maintenance.filter((m) => m.date.slice(0, 7) === month)));
  document.getElementById('assetMtYear').textContent = rand(sum(d.maintenance.filter((m) => m.date.slice(0, 4) === year)));
  const due = d.assets.filter((a) => assetHeld(a) && a.nextServiceDue && assetDaysUntil(a.nextServiceDue) <= 30)
    .sort((x, y) => (x.nextServiceDue < y.nextServiceDue ? -1 : 1));
  document.getElementById('assetMtDue').textContent = due.length;
  document.getElementById('assetMtDueCard').classList.toggle('is-warn', due.length > 0);
  document.getElementById('assetMtDueList').innerHTML = due.length ? due.map((a) => {
    const n = assetDaysUntil(a.nextServiceDue);
    return '<button type="button" class="fin-line asset-attn-row" data-asset="' + escapeAttr(a.id) + '">' +
      '<span class="fin-line-main"><span class="fin-line-desc">' + escapeHtml(a.id) + ' · ' + escapeHtml(a.name) + '</span>' +
      '<span class="fin-line-meta">' + escapeHtml(a.location) + ' · ' + escapeHtml(a.category) + '</span></span>' +
      '<span class="asset-attn-why"><span class="asset-why asset-why-' + (n < 0 ? 'bad' : 'warn') + '">' +
      escapeHtml(n < 0 ? 'Overdue since ' + assetWhen(a.nextServiceDue) : n === 0 ? 'Due today' : 'Due ' + assetWhen(a.nextServiceDue)) + '</span></span></button>';
  }).join('') : '<p class="muted">No services due in the next 30 days.</p>';
  document.getElementById('assetMtList').innerHTML = d.maintenance.length ? d.maintenance.map((m) => assetMaintLine(m, true)).join('')
    : '<p class="muted">No maintenance recorded yet.</p>';
}


// ── Stage 3: disposals ──────────────────────────────────────────────

function openAssetDispose() {
  const a = assetOpen.asset;
  const requestId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  openAssetForm({
    title: 'Dispose of asset', subtitle: assetSub(), submitLabel: assetData.canApprove ? 'Dispose' : 'Ask for approval',
    intro: (a.bookValue !== null ? 'Book value today: ' + rand(a.bookValue) + '. ' : '') +
      (assetData.canApprove ? 'As an Admin, this takes effect straight away.' : 'An Admin must approve this before the asset is taken off the register. They\'ll get an email.'),
    fields: [
      { id: 'method', label: 'How', type: 'select', options: [{ value: '', label: 'Choose…' }].concat(assetData.disposalMethods.map((m) => ({ value: m.key, label: m.key + ' → ' + m.status }))),
        required: true, requiredText: 'Choose how it is being disposed of.' },
      { id: 'date', label: 'Date', type: 'date', half: true, value: assetData.today, required: true, requiredText: 'Choose the date.' },
      { id: 'proceeds', label: 'Amount received (R)', type: 'number', half: true, required: (v) => v.method === 'Sold', requiredText: 'Enter how much it was sold for.' },
      { id: 'reason', label: 'Reason', type: 'textarea', max: 500, required: true, requiredText: 'Give a reason.' },
      { id: 'recipient', label: 'Sold or given to (optional)', half: true },
      { id: 'reference', label: 'Reference (optional)', half: true, placeholder: 'Invoice, police case no…' },
      { id: 'file', label: 'Supporting document (optional)', type: 'file' }
    ],
    submit: (v) => assetPost('assetDispose', { requestId: requestId, method: v.method, date: v.date, proceeds: v.proceeds, reason: v.reason,
      recipient: v.recipient, reference: v.reference, file: v.file })
  });
}

function openAssetDisposalDecision(op) {
  const p = assetOpen.asset.pendingDisposal;
  const titles = { approve: 'Approve disposal', reject: 'Reject disposal', cancel: 'Withdraw request' };
  openAssetForm({
    title: titles[op], subtitle: assetSub(), submitLabel: titles[op].split(' ')[0],
    intro: p.method + ' on ' + assetWhen(p.date) + ' — asked by ' + p.requestedBy + '. ' + (p.reason || ''),
    fields: [{ id: 'note', label: op === 'reject' ? 'Why is it rejected?' : 'Note (optional)', type: 'textarea', required: op === 'reject', requiredText: 'Say why it is rejected.' }],
    submit: (v) => apiPost('assetDisposalDecide', { requesterEmail: currentUser.email, disposalId: p.id, op: op, note: v.note })
  });
}

function disposalBanner(a) {
  const d = assetData;
  if (a.pendingDisposal) {
    const p = a.pendingDisposal;
    return '<div class="asset-dispose-banner"><strong>Disposal waiting for approval' + (p.method ? ': ' + escapeHtml(p.method) : '') + '</strong>' +
      (d.canEdit ? '<p>' + escapeHtml(assetWhen(p.date)) + ' · ' + escapeHtml(p.reason) + (p.proceeds !== null && p.proceeds !== undefined ? ' · ' + rand(p.proceeds) : '') + '</p>' +
        '<p class="muted">' + escapeHtml(p.id) + ' · asked by ' + escapeHtml(p.requestedBy) + ' on ' + escapeHtml(assetWhen(p.requestedAt)) + '</p>' +
        '<div class="asset-actions">' + (d.canApprove ? '<button type="button" class="btn-primary" id="assetDpApprove">Approve</button><button type="button" class="btn-secondary" id="assetDpReject">Reject</button>' : '') +
        (d.canApprove || assetOpen.disposals.some((x) => x.id === p.id && x.mine) ? '<button type="button" class="btn-secondary" id="assetDpCancel">Withdraw</button>' : '') + '</div>' : '') +
      '</div>';
  }
  if (a.disposal) {
    const x = a.disposal;
    return '<div class="asset-gone-banner"><strong>' + escapeHtml(a.status) + ': ' + escapeHtml(x.method) + ' on ' + escapeHtml(assetWhen(x.date)) + '</strong>' +
      (d.canEdit ? '<p>' + escapeHtml(x.reason || '') + '</p><p class="muted">' + escapeHtml(x.id) + ' · ' +
        (x.bookValue !== null ? 'book value ' + rand(x.bookValue) + ' · ' : '') + (x.proceeds !== null ? 'received ' + rand(x.proceeds) + ' · ' : '') +
        'approved by ' + escapeHtml(x.decidedBy) + (x.file ? '</p><p>' + fileButton(x.file, 'Supporting document') : '') + '</p>' : '') + '</div>';
  }
  return '';
}

function renderAssetDisposals() {
  const d = assetData;
  const name = (id) => { const a = d.assets.filter((x) => x.id === id)[0]; return a ? a.name : ''; };
  const line = (x) => '<div class="fin-line">' +
    '<span class="fin-line-main"><span class="fin-line-desc"><button type="button" class="link-btn asset-link" data-asset="' + escapeAttr(x.assetId) + '">' +
      escapeHtml(x.assetId + ' · ' + name(x.assetId)) + '</button></span>' +
    '<span class="fin-line-meta"><strong>' + escapeHtml(x.method) + '</strong> · ' + escapeHtml(assetWhen(x.date)) + ' · ' + escapeHtml(x.reason) + '</span>' +
    '<span class="fin-line-meta">' + escapeHtml(x.id) + ' · asked by ' + escapeHtml(x.requestedBy) +
      (x.status !== 'Pending' ? ' · ' + escapeHtml(x.status.toLowerCase()) + ' by ' + escapeHtml(x.decidedBy) + (x.decisionNote ? ' — ' + escapeHtml(x.decisionNote) : '') : '') + '</span></span>' +
    '<span class="fin-line-side">' + (x.proceeds !== null ? '<span class="fin-line-amt">' + rand(x.proceeds) + '</span>' : '') +
      (x.bookValue !== null && x.status === 'Approved' ? '<span class="muted">book ' + rand(x.bookValue) + '</span>' : '') +
      '<span class="status-tag ' + ({ Pending: 'as-warn', Approved: 'as-gone', Rejected: 'as-bad' }[x.status] || 'as-gone') + '">' + escapeHtml(x.status) + '</span></span></div>';
  const pending = d.disposals.filter((x) => x.status === 'Pending');
  const done = d.disposals.filter((x) => x.status !== 'Pending');
  document.getElementById('assetDpPending').innerHTML = pending.length ? pending.map(line).join('') : '<p class="muted">Nothing waiting.</p>';
  document.getElementById('assetDpDone').innerHTML = done.length ? done.map(line).join('') : '<p class="muted">None yet.</p>';
}

// ── Stage 3: verification counts ────────────────────────────────────

let assetCountOpen = null; // { count, lines, canCount, canCancel }

function renderAssetCounts() {
  const d = assetData;
  const sel = document.getElementById('assetCtLocation');
  if (!sel.options.length) sel.innerHTML = d.countLocations.map((l) => '<option value="' + escapeAttr(l) + '">' + escapeHtml(l) + '</option>').join('');
  document.getElementById('assetCtLocWrap').hidden = d.countLocations.length < 2;
  document.getElementById('assetCtError').textContent = '';
  const open = d.counts.filter((c) => c.status === 'Open');
  const done = d.counts.filter((c) => c.status !== 'Open');
  document.getElementById('assetCtOpen').innerHTML = open.length ? open.map((c) =>
    '<div class="fin-line"><span class="fin-line-main"><span class="fin-line-desc">' + escapeHtml(c.location) + ' · ' + escapeHtml(c.id) + '</span>' +
      '<span class="fin-line-meta">Started ' + escapeHtml(assetWhen(c.startedAt)) + ' by ' + escapeHtml(c.startedBy) + ' · ' + c.marked + ' of ' + c.total + ' checked</span>' +
      '<span class="asset-progress"><span style="width:' + Math.round(c.marked / Math.max(1, c.total) * 100) + '%"></span></span></span>' +
    '<span class="fin-line-side"><button type="button" class="btn-primary asset-tr-btn" data-count="' + escapeAttr(c.id) + '">Continue</button></span></div>').join('')
    : '<p class="muted">No count in progress.</p>';
  document.getElementById('assetCtDone').innerHTML = done.length ? done.map((c) =>
    '<div class="fin-line"><span class="fin-line-main"><span class="fin-line-desc">' + escapeHtml(c.location) + ' · ' + escapeHtml(c.id) + '</span>' +
      '<span class="fin-line-meta">' + (c.status === 'Completed' ? 'Finished ' : 'Cancelled ') + escapeHtml(assetWhen(c.finishedAt)) + ' by ' + escapeHtml(c.finishedBy) + '</span>' +
      (c.note ? '<span class="fin-line-meta">' + escapeHtml(c.note) + '</span>' : '') + '</span>' +
    '<span class="fin-line-side">' + (c.status === 'Completed'
      ? '<span class="asset-count-sum"><span class="asset-why asset-why-ok">' + c.found + ' found</span>' +
        (c.damaged ? '<span class="asset-why asset-why-warn">' + c.damaged + ' damaged</span>' : '') +
        (c.missing ? '<span class="asset-why asset-why-bad">' + c.missing + ' missing</span>' : '') + '</span>'
      : '<span class="status-tag as-gone">Cancelled</span>') +
      '<button type="button" class="link-btn" data-count="' + escapeAttr(c.id) + '">View</button></span></div>').join('')
    : '<p class="muted">No counts yet.</p>';
}

async function startAssetCountClick() {
  const btn = document.getElementById('assetCtStart');
  const err = document.getElementById('assetCtError');
  const loc = document.getElementById('assetCtLocation').value;
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Starting…';
  const res = await apiPost('assetCountStart', { requesterEmail: currentUser.email, location: loc });
  btn.disabled = false; btn.textContent = 'Start a count';
  if (!res.success && !res.id) { err.textContent = res.error || 'Could not start the count.'; return; }
  await loadAssetsPage();
  openAssetCount(res.id);
}

async function openAssetCount(id) {
  assetCountOpen = null;
  document.getElementById('assetCountTitle').textContent = 'Count ' + id;
  document.getElementById('assetCountSubtitle').textContent = '';
  document.getElementById('assetCountBody').innerHTML = '<p class="muted">Opening…</p>';
  document.getElementById('assetCountBackdrop').hidden = false;
  const res = await apiGet('assetCount', { email: currentUser.email, id: id });
  if (document.getElementById('assetCountBackdrop').hidden) return;
  if (!res.success) { document.getElementById('assetCountBody').innerHTML = '<p class="error-text">' + escapeHtml(res.error || 'Could not open the count.') + '</p>'; return; }
  assetCountOpen = res;
  renderAssetCount();
}

function renderAssetCount() {
  const c = assetCountOpen.count;
  const lines = assetCountOpen.lines;
  const open = c.status === 'Open' && assetCountOpen.canCount;
  const marked = lines.filter((l) => l.result).length;
  document.getElementById('assetCountTitle').textContent = 'Count · ' + c.location;
  document.getElementById('assetCountSubtitle').textContent = c.id + ' · started ' + assetWhen(c.startedAt) + ' by ' + c.startedBy +
    (c.status !== 'Open' ? ' · ' + c.status.toLowerCase() + ' ' + assetWhen(c.finishedAt) : '');
  const btn = (l, r, label) => '<button type="button" class="asset-ct-btn ct-' + r.toLowerCase() + (l.result === r ? ' is-on' : '') + '" data-ct-asset="' + escapeAttr(l.assetId) +
    '" data-ct-result="' + r + '"' + (open ? '' : ' disabled') + '>' + label + '</button>';
  let html = '<div class="asset-ct-top"><span><strong id="assetCtMarked">' + marked + '</strong> of ' + lines.length + ' checked</span>' +
    '<button type="button" class="link-btn" id="assetCtPrint">Print checklist</button></div>' +
    '<span class="asset-progress"><span id="assetCtBar" style="width:' + Math.round(marked / Math.max(1, lines.length) * 100) + '%"></span></span>';
  html += '<ul class="asset-ct-list">' + lines.map((l) =>
    '<li class="asset-ct-row' + (l.result ? ' is-' + l.result.toLowerCase() : '') + '" data-ct-row="' + escapeAttr(l.assetId) + '">' +
      '<div class="asset-ct-info"><strong>' + escapeHtml(l.assetId) + ' · ' + escapeHtml(l.name) + '</strong>' +
        '<span class="muted">' + escapeHtml([l.type || l.category, l.serial ? 'S/N ' + l.serial : '', l.assignedTo].filter((x) => x).join(' · ')) + '</span></div>' +
      '<div class="asset-ct-btns">' + btn(l, 'Found', 'Here') + btn(l, 'Damaged', 'Damaged') + btn(l, 'Missing', 'Missing') + '</div>' +
      '<input type="text" class="asset-ct-note" data-ct-note="' + escapeAttr(l.assetId) + '" maxlength="300" placeholder="' + (l.result === 'Missing' ? 'Where was it last seen? (optional)' : 'What is damaged?') + '" value="' + escapeAttr(l.note) + '"' +
        (l.result === 'Damaged' || l.result === 'Missing' ? '' : ' hidden') + (open ? '' : ' disabled') + '>' +
    '</li>').join('') + '</ul>';
  if (open) {
    html += '<label>Anything else to note? (optional) <textarea id="assetCtNote" rows="2" maxlength="500" placeholder="e.g. found items that aren\'t on the list"></textarea></label>' +
      '<p class="error-text" id="assetCtFinishError"></p><div class="asset-actions">' +
      '<button type="button" class="btn-primary" id="assetCtFinish"' + (marked < lines.length ? ' disabled' : '') + '>Finish count</button>' +
      (assetCountOpen.canCancel ? '<button type="button" class="btn-secondary" id="assetCtCancel">Cancel count</button>' : '') + '</div>';
  } else if (c.status === 'Completed') {
    html += '<p class="muted">' + c.found + ' found · ' + c.damaged + ' damaged · ' + c.missing + ' missing' + (c.note ? ' — ' + escapeHtml(c.note) : '') + '</p>';
  }
  document.getElementById('assetCountBody').innerHTML = html;
  const body = document.getElementById('assetCountBody');
  body.querySelectorAll('[data-ct-result]').forEach((b) => b.addEventListener('click', () => markCountLine(b.dataset.ctAsset, b.dataset.ctResult)));
  body.querySelectorAll('[data-ct-note]').forEach((inp) => inp.addEventListener('change', () => {
    const l = lines.filter((x) => x.assetId === inp.dataset.ctNote)[0];
    if (l && l.result) markCountLine(l.assetId, l.result, inp.value.trim(), true);
  }));
  document.getElementById('assetCtPrint').addEventListener('click', printAssetCount);
  const fin = document.getElementById('assetCtFinish');
  if (fin) fin.addEventListener('click', finishAssetCount);
  const can = document.getElementById('assetCtCancel');
  if (can) can.addEventListener('click', cancelAssetCount);
}

async function markCountLine(assetId, result, note, keepResult) {
  const l = assetCountOpen.lines.filter((x) => x.assetId === assetId)[0];
  const before = { result: l.result, note: l.note };
  if (!keepResult && l.result === result) result = ''; // tap again to undo
  l.result = result;
  if (note !== undefined) l.note = note;
  if (result === 'Found' || !result) l.note = '';
  const row = document.querySelector('[data-ct-row="' + assetId + '"]');
  row.className = 'asset-ct-row' + (result ? ' is-' + result.toLowerCase() : '');
  row.querySelectorAll('[data-ct-result]').forEach((b) => b.classList.toggle('is-on', b.dataset.ctResult === result));
  const inp = row.querySelector('[data-ct-note]');
  inp.hidden = !(result === 'Damaged' || result === 'Missing');
  inp.placeholder = result === 'Missing' ? 'Where was it last seen? (optional)' : 'What is damaged?';
  if (!result || result === 'Found') inp.value = '';
  if (result === 'Damaged' && !keepResult && !l.note) setTimeout(() => inp.focus(), 30);
  updateCountProgress();
  const res = await apiPost('assetCount', { requesterEmail: currentUser.email, countId: assetCountOpen.count.id, op: 'mark', assetId: assetId, result: result, note: l.note });
  if (!res.success) {
    l.result = before.result; l.note = before.note;
    renderAssetCount();
    const e = document.getElementById('assetCtFinishError');
    if (e) e.textContent = res.error || 'Could not save that — check your connection and tap again.';
  }
}

function updateCountProgress() {
  const lines = assetCountOpen.lines;
  const marked = lines.filter((l) => l.result).length;
  document.getElementById('assetCtMarked').textContent = marked;
  document.getElementById('assetCtBar').style.width = Math.round(marked / Math.max(1, lines.length) * 100) + '%';
  const fin = document.getElementById('assetCtFinish');
  if (fin) fin.disabled = marked < lines.length;
}

async function finishAssetCount() {
  const btn = document.getElementById('assetCtFinish');
  const err = document.getElementById('assetCtFinishError');
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Finishing…';
  const res = await apiPost('assetCount', { requesterEmail: currentUser.email, countId: assetCountOpen.count.id, op: 'finish', note: document.getElementById('assetCtNote').value.trim() });
  btn.textContent = 'Finish count';
  if (!res.success) { btn.disabled = false; err.textContent = res.error || 'Could not finish the count.'; return; }
  const id = assetCountOpen.count.id;
  await loadAssetsPage();
  if (res.warning) alertAssetNotice(res.warning);
  openAssetCount(id);
}

async function cancelAssetCount() {
  const btn = document.getElementById('assetCtCancel');
  if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Tap again to cancel the count'; return; }
  btn.disabled = true;
  const res = await apiPost('assetCount', { requesterEmail: currentUser.email, countId: assetCountOpen.count.id, op: 'cancel' });
  if (!res.success) { btn.disabled = false; document.getElementById('assetCtFinishError').textContent = res.error || 'Could not cancel.'; return; }
  document.getElementById('assetCountBackdrop').hidden = true;
  assetCountOpen = null;
  loadAssetsPage();
}

// ── Stage 3: printing ───────────────────────────────────────────────

function assetPrintDoc(title, sub, bodyHtml) {
  const e = escapeHtml;
  const logo = new URL('assets/logo.jpg', location.href).href;
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(title) + '</title><style>' +
    '@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#142132;margin:0;padding:16px;font-size:11px}' +
    'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0d53af;padding-bottom:8px;margin-bottom:12px}header img{height:42px}' +
    'h1{font-size:18px;margin:0;color:#0d53af}.sub{color:#5e6a7a;margin-top:2px}' +
    'table{width:100%;border-collapse:collapse}td,th{padding:5px 6px;border-bottom:1px solid #e3e8ef;text-align:left;vertical-align:top}' +
    'th{font-size:9.5px;color:#5e6a7a;text-transform:uppercase;background:#f3f6fa}.r{text-align:right;white-space:nowrap}.box{width:16px;height:16px;border:1.5px solid #142132;display:inline-block}' +
    'tfoot td{font-weight:bold;border-top:2px solid #142132}.sm{color:#5e6a7a;font-size:10px}.sig{margin-top:28px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px}' +
    '.sig div{border-top:1px solid #142132;padding-top:4px;color:#5e6a7a}footer{margin-top:16px;color:#8a95a5;font-size:9.5px;border-top:1px solid #dfe5ee;padding-top:6px}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>' +
    '<header><img src="' + e(logo) + '" alt=""><div><h1>' + e(title) + '</h1><div class="sub">' + e(sub) + '</div></div></header>' + bodyHtml +
    '<footer>Vision Cash-Up · printed ' + e(new Date().toLocaleString('en-ZA')) + '</footer></body></html>';
}

function printAssetRegister() {
  const d = assetData;
  const list = assetRegisterList();
  const e = escapeHtml;
  const money = (v) => (v === null || v === undefined ? '—' : rand(v));
  const loc = document.getElementById('assetLocFilter').value || 'All locations';
  const catSel = document.getElementById('assetCatFilter');
  const stSel = document.getElementById('assetStatusFilter');
  const sub = [loc, catSel.value ? catSel.options[catSel.selectedIndex].text : 'All categories', stSel.options[stSel.selectedIndex].text,
    list.length + ' asset' + (list.length === 1 ? '' : 's')].join(' · ');
  const head = '<tr><th>Asset ID</th><th>Name</th><th>Category / type</th><th>Location</th><th>Serial no.</th><th>Assigned to</th><th>Status</th><th>Condition</th>' +
    (d.canEdit ? '<th>Acquired</th><th class="r">Cost / value</th><th class="r">Book value</th>' : '') + '<th>Last verified</th></tr>';
  const rows = list.map((a) => '<tr><td class="r" style="text-align:left">' + e(a.id) + '</td><td><strong>' + e(a.name) + '</strong></td><td>' + e(a.category) + (a.type ? '<div class="sm">' + e(a.type) + '</div>' : '') +
    '</td><td>' + e(a.location) + '</td><td>' + e(a.serial) + '</td><td>' + e(a.assignedTo) + '</td><td>' + e(a.status) + (a.transfer ? '<div class="sm">to ' + e(a.transfer.to) + '</div>' : '') +
    '</td><td>' + e(a.condition) + '</td>' + (d.canEdit ? '<td>' + e(assetWhen(a.acquiredDate)) + '</td><td class="r">' + money(a.value) + '</td><td class="r">' + money(a.bookValue) + '</td>' : '') +
    '<td>' + e(assetWhen(a.lastVerified)) + '</td></tr>').join('');
  const tot = d.canEdit ? '<tfoot><tr><td colspan="9">Total</td><td class="r">' + rand(list.reduce((t, a) => t + (a.value || 0), 0)) + '</td><td class="r">' +
    rand(list.reduce((t, a) => t + (a.bookValue || 0), 0)) + '</td><td></td></tr></tfoot>' : '';
  openReportViewer('Asset register', sub, assetPrintDoc('Asset register', sub + ' · as at ' + assetWhen(d.today), '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody>' + tot + '</table>'));
}

function printAssetCount() {
  const c = assetCountOpen.count;
  const e = escapeHtml;
  const mark = (l, r) => (l.result === r ? '✔' : '');
  const rows = assetCountOpen.lines.map((l) => '<tr><td>' + e(l.assetId) + '</td><td><strong>' + e(l.name) + '</strong><div class="sm">' + e(l.type || l.category) + '</div></td>' +
    '<td>' + e(l.serial) + '</td><td>' + e(l.assignedTo) + '</td>' +
    ['Found', 'Damaged', 'Missing'].map((r) => '<td style="text-align:center"><span class="box">' + mark(l, r) + '</span></td>').join('') +
    '<td style="width:26%">' + e(l.note) + '</td></tr>').join('');
  const sub = c.location + ' · ' + c.id + ' · started ' + assetWhen(c.startedAt) + ' by ' + c.startedBy;
  openReportViewer('Asset count checklist', sub, assetPrintDoc('Asset count checklist — ' + c.location, sub,
    '<table><thead><tr><th>Asset ID</th><th>Name</th><th>Serial no.</th><th>Assigned to</th><th>Here</th><th>Damaged</th><th>Missing</th><th>Notes</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="sig"><div>Counted by</div><div>Signature</div><div>Date</div></div>'));
}


// ── Phase 2: till sessions (open with a float, close with a count) ───

function posSession() { return posRead(posKey('session'), null); }
function posSetSession(s) { posWrite(posKey('session'), s); }

// The open session for this branch + till on this device, picking up one the
// server knows about if this device lost its copy.
function posCurrentSession() {
  const dev = posDevice();
  let s = posSession();
  if (s && (s.branch !== posBranchNow() || s.till !== dev.till)) s = null;
  if (!s && posCfg && posCfg.openSessions) {
    const srv = posCfg.openSessions.filter((x) => x.till === dev.till)[0];
    if (srv) { s = { id: srv.id, branch: posBranchNow(), till: dev.till, date: srv.date, float: srv.float, openedAt: srv.openedAt, openedBy: srv.openedBy }; posSetSession(s); }
  }
  return s && !s.closed ? s : null;
}

function renderPosSessionState() {
  const s = posCurrentSession();
  const today = posNowString().slice(0, 10);
  const stale = s && s.date < today;
  document.getElementById('posOpenPanel').hidden = !!s;
  document.getElementById('posStalePanel').hidden = !stale;
  document.getElementById('posSellGrid').hidden = !s || stale;
  document.getElementById('posCloseTillBtn').hidden = !s;
  document.getElementById('posSessionLine').textContent = s ? 'Opened ' + assetWhen(s.openedAt.slice(0, 16)) + ' by ' + s.openedBy + ' with a float of ' + rand(s.float) + '.' : '';
  if (stale) document.getElementById('posStaleHint').textContent = 'Till ' + s.till + ' was opened on ' + assetWhen(s.date) + ' and never closed. Close it (count the drawer) before selling today.';
  if (!s) {
    const last = posRead('pos_lastfloat:' + posBranchNow() + ':' + posDevice().till, null);
    const inp = document.getElementById('posFloatIn');
    if (inp.value === '' && last !== null) inp.value = last;
    document.getElementById('posOpenTitle').textContent = 'Open Till ' + posDevice().till;
  }
}

function openPosTill() {
  const err = document.getElementById('posOpenError');
  const raw = document.getElementById('posFloatIn').value;
  const float = posMoney(raw);
  err.textContent = '';
  if (raw === '' || !(float >= 0 && float <= 100000)) { err.textContent = 'Enter the cash in the drawer (R0 if it is empty).'; return; }
  const dev = posDevice();
  const s = { id: 'sess-' + posUid(), branch: posBranchNow(), till: dev.till, date: posNowString().slice(0, 10), float: float, openedAt: posNowString(), openedBy: posCashier().name };
  posSetSession(s);
  const q = posQueue();
  q.push({ opId: 'open-' + s.id, type: 'open', branch: s.branch, session: { id: s.id, till: s.till, float: float, openedAt: s.openedAt, by: s.openedBy } });
  posSetQueue(q);
  document.getElementById('posFloatIn').value = '';
  renderPosSell();
  posSyncNow();
}

function posSessionSales(sid) { return posRecent().filter((x) => x.sessionId === sid && x.status !== 'Cancelled'); }

function openPosCloseTill() {
  const s = posSession();
  if (!s || s.closed) return;
  const list = posSessionSales(s.id).map((x) => ({ kind: x.kind || 'Sale', method: x.method, total: x.total }));
  const t = { cashSales: 0, cardSales: 0, otherSales: 0, cashRefunds: 0, cardRefunds: 0, otherRefunds: 0, sales: 0 };
  list.forEach((x) => {
    const m = x.method === 'Cash' ? 'cash' : x.method === 'Card' ? 'card' : 'other';
    if (x.kind === 'Refund') t[m + 'Refunds'] += -x.total; else { t[m + 'Sales'] += x.total; t.sales++; }
  });
  const expected = posMoney(s.float + t.cashSales - t.cashRefunds);
  const row = (a, b, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + a + '</td><td class="n">' + b + '</td></tr>';
  openPosDialog({
    title: 'Close Till ' + s.till, sub: s.branch + ' · opened ' + assetWhen(s.openedAt.slice(0, 16)) + ' by ' + s.openedBy,
    body: '<table class="pos-mini pos-close-table">' + row('Sales', t.sales) + row('Card', rand(t.cardSales - t.cardRefunds)) + row('EFT / other', rand(t.otherSales - t.otherRefunds)) +
      row('Opening float', rand(s.float)) + row('+ Cash sales', rand(t.cashSales)) + row('− Cash refunds', rand(t.cashRefunds)) +
      row('<strong>Cash that should be in the drawer</strong>', '<strong>' + rand(expected) + '</strong>', 'pos-exp') + '</table>' +
      '<div class="grid-2"><label>Cash counted in the drawer (R) <input type="number" id="pdCounted" min="0" step="0.01" inputmode="decimal"></label>' +
      '<label>Float kept for tomorrow (R) <input type="number" id="pdKept" min="0" step="0.01" inputmode="decimal" value="' + s.float + '"></label></div>' +
      '<p class="pos-diff" id="pdDiff"></p><label>Note (optional) <input type="text" id="pdNote" maxlength="300" placeholder="e.g. explain a short or over"></label>',
    ok: 'Close till',
    onOk: () => {
      const cRaw = document.getElementById('pdCounted').value;
      const counted = posMoney(cRaw);
      const kept = posMoney(document.getElementById('pdKept').value);
      if (cRaw === '' || !(counted >= 0)) return 'Count the cash in the drawer and enter it.';
      if (!(kept >= 0 && kept <= counted)) return 'The float kept can\'t be more than the cash counted.';
      const q = posQueue();
      q.push({ opId: 'close-' + s.id, type: 'close', branch: s.branch, sessionId: s.id, counted: counted, floatKept: kept,
        note: document.getElementById('pdNote').value.trim(), closedAt: posNowString(), by: posCashier().name });
      posSetQueue(q);
      posWrite('pos_lastfloat:' + s.branch + ':' + s.till, kept);
      const closed = Object.assign({}, s, { closed: true, closedAt: posNowString(), closedBy: posCashier().name, counted: counted, floatKept: kept,
        expected: expected, difference: posMoney(counted - expected), totals: t, note: document.getElementById('pdNote').value.trim() });
      posSetSession(closed);
      posWrite(posKey('lastclosed'), closed);
      posSyncNow();
      setTimeout(() => showPosClosed(closed), 0);
      return '';
    }
  });
  const upd = () => {
    const c = document.getElementById('pdCounted').value;
    const el = document.getElementById('pdDiff');
    if (c === '') { el.textContent = ''; return; }
    const d = posMoney(posMoney(c) - expected);
    el.textContent = d === 0 ? 'Balances exactly.' : (d > 0 ? 'Over by ' + rand(d) : 'Short by ' + rand(-d));
    el.className = 'pos-diff ' + (d === 0 ? 'ok' : d > 0 ? 'over' : 'short');
  };
  document.getElementById('pdCounted').addEventListener('input', upd);
}

function showPosClosed(c) {
  openPosDialog({
    title: 'Till ' + c.till + ' closed', sub: c.branch + ' · ' + assetWhen(c.closedAt.slice(0, 16)),
    body: '<p class="pos-diff ' + (c.difference === 0 ? 'ok' : c.difference > 0 ? 'over' : 'short') + '">' +
      (c.difference === 0 ? 'The drawer balances.' : (c.difference > 0 ? 'Over by ' : 'Short by ') + rand(Math.abs(c.difference))) + '</p>' +
      '<p class="muted">Expected ' + rand(c.expected) + ', counted ' + rand(c.counted) + '. Float kept: ' + rand(c.floatKept) + '.</p>' +
      '<p class="muted">Next: do the Daily Cash-Up. Tap <strong>Fill in from the till</strong> there and the sales, card and refund figures are entered for you.</p>' +
      '<button type="button" class="btn-secondary pos-inline-btn" id="pdPrintZ">Print till slip</button>',
    ok: featureOn('pos') && allowedPages().indexOf('cashup') !== -1 ? 'Go to Daily Cash-Up' : 'Done',
    onOk: () => { if (allowedPages().indexOf('cashup') !== -1) setTimeout(() => openPage('cashup'), 0); return ''; }
  });
  document.getElementById('posDialogCancel').textContent = 'Stay on the till';
  document.getElementById('pdPrintZ').addEventListener('click', () => printPosTillSlip(c));
  renderPosSell();
}

function printPosTillSlip(c) {
  const e = escapeHtml;
  const t = c.totals || {};
  const money = (v) => 'R' + Number(v || 0).toFixed(2);
  const row = (a, b) => '<tr><td>' + a + '</td><td class="r">' + b + '</td></tr>';
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:' + (posDevice().paper === 58 ? 58 : 80) + 'mm auto;margin:0}' +
    'body{width:' + (posDevice().paper === 58 ? 48 : 72) + 'mm;margin:0 auto;padding:3mm 0 6mm;font-family:Arial,sans-serif;font-size:11.5px}' +
    'h1{font-size:14px;text-align:center;margin:0 0 2mm}table{width:100%;border-collapse:collapse}td{padding:.5mm 0}.r{text-align:right}hr{border:0;border-top:1px dashed #000;margin:2mm 0}' +
    '.b td{font-weight:bold;font-size:13px}</style></head><body><h1>TILL ' + c.till + ' CLOSED</h1><div style="text-align:center">' + e(c.branch) + '</div><hr><table>' +
    row('Opened', e(assetWhen(c.openedAt.slice(0, 16)))) + row('By', e(c.openedBy)) + row('Closed', e(assetWhen(c.closedAt.slice(0, 16)))) + row('By', e(c.closedBy)) + '</table><hr><table>' +
    row('Sales', t.sales || 0) + row('Cash sales', money(t.cashSales)) + row('Card sales', money(t.cardSales)) + row('EFT / other', money(t.otherSales)) +
    row('Cash refunds', money(t.cashRefunds)) + row('Card refunds', money(t.cardRefunds)) + '</table><hr><table>' +
    row('Opening float', money(c.float)) + row('Expected cash', money(c.expected)) + row('Counted cash', money(c.counted)) +
    '<tr class="b"><td>' + (c.difference >= 0 ? 'Over' : 'Short') + '</td><td class="r">' + money(Math.abs(c.difference)) + '</td></tr>' + row('Float kept', money(c.floatKept)) +
    '</table>' + (c.note ? '<hr>' + e(c.note) : '') + '<hr><div style="margin-top:8mm">Signature: ____________________</div></body></html>';
  const frame = document.getElementById('posPrintFrame');
  frame.onload = () => { frame.onload = null; try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { /* ignore */ } };
  frame.srcdoc = html;
}

// ── Phase 2: find a receipt, reprint, refund ───────────────────────

let posFound = [];      // search results (server + this device)
let posRefundFor = null;

function openPosFind(prefill) {
  document.getElementById('posReceiptTitle').textContent = 'Find a receipt';
  document.getElementById('posFindRow').hidden = false;
  document.getElementById('posFindIn').value = prefill || '';
  document.getElementById('posReceiptBody').innerHTML = '<p class="muted">Type the number on the slip. The last digits are enough (e.g. 124).</p>';
  document.getElementById('posReceiptBackdrop').hidden = false;
  if (prefill) runPosFind(); else setTimeout(() => document.getElementById('posFindIn').focus(), 30);
}

// Merge a device-only sale (not sent yet) into the server's shape.
function posLocalAsServer(x) {
  return Object.assign({}, x, { kind: x.kind || 'Sale', pending: !x.sent,
    lines: x.lines.map((l, i) => ({ line: l.line || i + 1, categoryId: l.categoryId, category: l.categoryName, description: l.description,
      qty: x.kind === 'Refund' ? -l.qty : l.qty, price: l.price, lineTotal: (x.kind === 'Refund' ? -1 : 1) * posMoney(l.qty * l.price) })) });
}

async function runPosFind() {
  const term = document.getElementById('posFindIn').value.trim().toUpperCase();
  const body = document.getElementById('posReceiptBody');
  if (!term) return;
  body.innerHTML = '<p class="muted">Searching…</p>';
  const digits = /^\d+$/.test(term) ? Number(term) : null;
  const matches = (no) => no === term || (digits !== null && Number(no.split('-').pop()) === digits);
  const local = posRecent().filter((x) => x.branch === posBranchNow());
  const res = await apiGet('posReceipt', { email: currentUser.email, branch: posBranchNow(), q: term });
  const byUid = {};
  if (res.success) res.sales.forEach((x) => { byUid[x.uid] = x; });
  local.filter((x) => matches(x.receiptNo)).forEach((x) => { if (!byUid[x.uid]) byUid[x.uid] = Object.assign(posLocalAsServer(x), { refunds: [] }); });
  // refunds made on this device that the server doesn't have yet
  Object.keys(byUid).forEach((u) => {
    const s = byUid[u];
    s.refunds = s.refunds || [];
    local.filter((x) => x.kind === 'Refund' && x.refundOf === u && !s.refunds.some((r) => r.uid === x.uid)).forEach((x) => s.refunds.push(posLocalAsServer(x)));
    local.filter((x) => x.kind === 'Refund' && x.status === 'Cancelled').forEach((x) => s.refunds.forEach((r) => { if (r.uid === x.uid) r.status = 'Cancelled'; }));
  });
  posFound = Object.keys(byUid).map((u) => byUid[u]).sort((a, b) => (a.time < b.time ? 1 : -1));
  if (!posFound.length) {
    body.innerHTML = '<p class="muted">' + (res.success ? 'No receipt ' + escapeHtml(term) + ' at ' + escapeHtml(posBranchNow()) + '.' : 'Offline — only receipts on this device can be found, and none match.') + '</p>';
    return;
  }
  body.innerHTML = posFound.map((x, i) => posReceiptCard(x, i)).join('');
}

function posReceiptCard(x, i) {
  const e = escapeHtml;
  const refunded = posRefundedQty(x);
  const canRefund = x.kind !== 'Refund' && x.status !== 'Cancelled' && x.lines.some((l) => l.qty - (refunded[l.line] || 0) > 0);
  return '<div class="pos-rcpt-card">' +
    '<div class="pos-rcpt-head"><strong>' + e(x.receiptNo) + '</strong>' + (x.kind === 'Refund' ? ' <span class="status-tag as-warn">Refund</span>' : '') +
      (x.status === 'Cancelled' ? ' <span class="status-tag as-gone">Cancelled</span>' : '') + (x.pending ? ' <span class="status-tag as-info">Not sent yet</span>' : '') +
      '<span class="muted">' + e(assetWhen(x.time.slice(0, 16))) + ' · ' + e(x.method) + ' · ' + e(x.cashierName) + '</span></div>' +
    '<table class="pos-mini">' + x.lines.map((l) => '<tr><td>' + Math.abs(l.qty) + ' × ' + e(l.category + (l.description ? ' – ' + l.description : '')) +
      (refunded[l.line] ? ' <span class="muted">(' + refunded[l.line] + ' refunded)</span>' : '') + '</td><td class="n">' + rand(l.lineTotal) + '</td></tr>').join('') +
      '<tr><td><strong>Total</strong></td><td class="n"><strong>' + rand(x.total) + '</strong></td></tr></table>' +
    (x.kind === 'Refund' ? '<p class="muted">Refund of ' + e(x.refundOfReceipt || '') + (x.refundReason ? ' — ' + e(x.refundReason) : '') + '</p>' : '') +
    (x.refunds && x.refunds.length ? '<p class="muted">' + x.refunds.map((r) => 'Refunded ' + rand(-r.total) + ' on ' + e(assetWhen(r.time.slice(0, 16))) + ' (' + e(r.receiptNo) + ')' +
      (r.status === 'Cancelled' ? ' — cancelled' : '')).join('<br>') + '</p>' : '') +
    '<div class="asset-actions"><button type="button" class="btn-secondary" data-rcpt-print="' + i + '">Reprint</button>' +
      (canRefund ? '<button type="button" class="btn-primary" data-rcpt-refund="' + i + '">Refund…</button>' : '') + '</div></div>';
}

function posRefundedQty(x) {
  const out = {};
  (x.refunds || []).filter((r) => r.status !== 'Cancelled').forEach((r) => r.lines.forEach((l) => { out[l.line] = (out[l.line] || 0) + Math.abs(l.qty); }));
  return out;
}

function posServerToReceipt(x) {
  return Object.assign({}, x, { lines: x.lines.map((l) => ({ line: l.line, categoryId: l.categoryId, categoryName: l.category, description: l.description,
    qty: Math.abs(l.qty), price: l.price })) });
}

function openPosRefund(i) {
  const x = posFound[i];
  posRefundFor = x;
  const refunded = posRefundedQty(x);
  const e = escapeHtml;
  document.getElementById('posReceiptTitle').textContent = 'Refund · ' + x.receiptNo;
  document.getElementById('posFindRow').hidden = true;
  document.getElementById('posReceiptBody').innerHTML =
    '<p class="muted">Choose how many of each item come back. Prices are from the original sale.</p>' +
    '<div class="pos-refund-lines">' + x.lines.map((l) => {
      const left = l.qty - (refunded[l.line] || 0);
      return '<div class="pos-refund-line"><span><strong>' + e(l.category + (l.description ? ' – ' + l.description : '')) + '</strong><span class="muted">' +
        l.qty + ' sold @ ' + rand(l.price) + (refunded[l.line] ? ' · ' + refunded[l.line] + ' already refunded' : '') + '</span></span>' +
        '<input type="number" min="0" max="' + left + '" step="1" value="0" data-rf-line="' + l.line + '" data-rf-price="' + l.price + '"' + (left ? '' : ' disabled') + ' aria-label="Quantity to refund"></div>';
    }).join('') + '</div>' +
    '<div class="grid-2"><label>Refund paid by <select id="rfMethod">' + posCfg.methods.map((m) => '<option' + (m === x.method ? ' selected' : '') + '>' + e(m) + '</option>').join('') + '</select></label>' +
    '<label>Reason <input type="text" id="rfReason" maxlength="300" placeholder="e.g. wrong size, faulty"></label></div>' +
    '<div class="pos-line-total"><span>Refund total</span><strong id="rfTotal">R 0.00</strong></div>' +
    '<p class="error-text" id="rfError"></p>' +
    '<div class="user-edit-actions"><button type="button" class="btn-secondary" id="rfBack">Back</button><button type="button" class="btn-primary" id="rfGo">Refund</button></div>';
  const upd = () => {
    let t = 0;
    document.querySelectorAll('[data-rf-line]').forEach((inp) => { t += (Number(inp.value) || 0) * Number(inp.dataset.rfPrice); });
    document.getElementById('rfTotal').textContent = rand(t);
    document.getElementById('rfGo').textContent = t ? 'Refund ' + rand(t) : 'Refund';
  };
  document.querySelectorAll('[data-rf-line]').forEach((inp) => inp.addEventListener('input', upd));
  document.getElementById('rfBack').addEventListener('click', () => { document.getElementById('posFindRow').hidden = false; document.getElementById('posReceiptTitle').textContent = 'Find a receipt'; runPosFind(); });
  document.getElementById('rfGo').addEventListener('click', doPosRefund);
}

function doPosRefund() {
  const x = posRefundFor;
  const err = document.getElementById('rfError');
  err.textContent = '';
  const refunded = posRefundedQty(x);
  const lines = [];
  let bad = '';
  document.querySelectorAll('[data-rf-line]').forEach((inp) => {
    const qty = Number(inp.value) || 0;
    if (!qty) return;
    const ol = x.lines.filter((l) => String(l.line) === inp.dataset.rfLine)[0];
    const left = ol.qty - (refunded[ol.line] || 0);
    if (qty < 0 || qty > left || Math.round(qty) !== qty) bad = 'Only ' + left + ' × ' + (ol.description || ol.category) + ' can be refunded.';
    lines.push({ line: ol.line, categoryId: ol.categoryId, categoryName: ol.category, description: ol.description, qty: qty, price: ol.price });
  });
  if (bad) { err.textContent = bad; return; }
  if (!lines.length) { err.textContent = 'Choose what is being refunded.'; return; }
  const reason = document.getElementById('rfReason').value.trim();
  if (!reason) { err.textContent = 'Give a reason for the refund.'; return; }
  const session = posCurrentSession();
  if (!session) { err.textContent = 'Open the till first.'; return; }
  const dev = posDevice();
  const branch = posBranchNow();
  const seqKey = 'pos_seq:' + branch + ':' + dev.till;
  const seq = Math.max(Number(posRead(seqKey, 0)) || 0, Number((posCfg.lastSeq || {})[String(dev.till)]) || 0) + 1;
  const total = -posMoney(lines.reduce((t, l) => t + posMoney(l.qty * l.price), 0));
  const cashier = posCashier();
  const refund = { uid: posUid(), receiptNo: (posCfg.codes[branch] || 'BR') + '-T' + dev.till + '-' + String(seq).padStart(6, '0'), till: dev.till, time: posNowString(),
    cashierId: cashier.id, cashierName: cashier.name, method: document.getElementById('rfMethod').value, total: total, cashReceived: null, change: null,
    kind: 'Refund', refundOf: x.uid, refundOfReceipt: x.receiptNo, reason: reason, sessionId: session.id, lines: lines };
  const q = posQueue();
  q.push({ opId: 'o-' + refund.uid, type: 'sale', branch: branch, sale: Object.assign({}, refund, { lines: lines.map((l) => ({ line: l.line, qty: l.qty })) }) });
  posSetQueue(q);
  posWrite(seqKey, seq);
  const recent = posRecent();
  recent.unshift(Object.assign({ branch: branch, status: 'Completed', sent: false }, refund));
  posSetRecent(recent);
  document.getElementById('posReceiptBody').innerHTML = '<div class="pos-done"><p class="pos-done-title">Refund done</p>' +
    '<p class="pos-done-change">' + (refund.method === 'Cash' ? 'Give back ' + rand(-total) + ' cash' : rand(-total) + ' · ' + escapeHtml(refund.method)) + '</p>' +
    '<p class="muted">' + escapeHtml(refund.receiptNo) + ' · refund of ' + escapeHtml(x.receiptNo) + '</p>' +
    (refund.method === 'Card' ? '<p class="muted">Do the refund on the card machine too.</p>' : '') +
    '<div class="pos-done-actions"><button type="button" class="btn-secondary" id="rfPrint">Print refund slip</button><button type="button" class="btn-primary" id="rfDone">Done</button></div></div>';
  document.getElementById('rfPrint').addEventListener('click', () => printPosReceipt(Object.assign({ branch: branch }, refund), false));
  document.getElementById('rfDone').addEventListener('click', () => { document.getElementById('posReceiptBackdrop').hidden = true; });
  if (posDevice().autoPrint) printPosReceipt(Object.assign({ branch: branch }, refund), false);
  renderPosRecent();
  posSyncNow();
}

// ── Phase 2: the Daily Cash-Up gets the till's figures ─────────────

let tillCashup = null;
let tillCashupSeq = 0;

async function loadTillCashup() {
  const card = document.getElementById('tillCashupCard');
  card.hidden = !featureOn('pos');
  if (card.hidden) return;
  const branch = document.getElementById('mBranch').value.trim();
  const date = document.getElementById('mDate').value;
  const body = document.getElementById('tillCashupBody');
  if (!branch || !date) { body.innerHTML = '<p class="muted">Choose the branch and date.</p>'; return; }
  const seq = ++tillCashupSeq;
  body.innerHTML = '<p class="muted">Checking the till for ' + escapeHtml(assetWhen(date)) + '…</p>';
  const res = await apiGet('posCashup', { email: currentUser.email, branch: branch, date: date });
  if (seq !== tillCashupSeq) return;
  if (!res.success) { body.innerHTML = '<p class="muted">' + escapeHtml(res.networkError ? 'Offline — can\'t check the till right now.' : (res.error || 'Could not check the till.')) + '</p>'; tillCashup = null; return; }
  tillCashup = res;
  if (!res.count && !res.refundCount) { body.innerHTML = '<p class="muted">No till sales were recorded at ' + escapeHtml(branch) + ' on ' + escapeHtml(assetWhen(date)) + '. Fill in the form by hand.</p>'; return; }
  const e = escapeHtml;
  const open = res.sessions.filter((s) => s.status === 'Open');
  const gross = posMoney(res.cashSales + res.cardSales + res.otherSales - res.cardRefunds - res.otherRefunds);
  body.innerHTML =
    '<div class="till-cu-grid">' +
      '<div><span class="kpi-label">Sales</span><strong>' + res.count + '</strong></div>' +
      '<div><span class="kpi-label">Cash</span><strong>' + rand(res.cashSales) + '</strong></div>' +
      '<div><span class="kpi-label">Card</span><strong>' + rand(res.cardSales) + '</strong></div>' +
      '<div><span class="kpi-label">EFT / other</span><strong>' + rand(res.otherSales) + '</strong></div>' +
      '<div><span class="kpi-label">Refunds</span><strong>' + rand(res.cashRefunds + res.cardRefunds + res.otherRefunds) + '</strong></div>' +
    '</div>' +
    '<p class="muted">Receipts ' + e(res.firstReceipt) + ' to ' + e(res.lastReceipt) + ' · cashiers: ' + e(res.cashiers.join(', ')) +
      (res.cancelled ? ' · ' + res.cancelled + ' cancelled (' + rand(res.cancelledValue) + ', not counted)' : '') + '</p>' +
    (res.sessions.length ? '<table class="pos-mini">' + res.sessions.map((s) => '<tr><td>Till ' + s.till + ' · ' + (s.status === 'Open' ? '<strong>still open</strong>' :
      'counted ' + rand(s.counted) + ' vs expected ' + rand(s.expected)) + '</td><td class="n">' + (s.status === 'Open' ? '' :
      '<span class="pos-diff ' + (s.difference === 0 ? 'ok' : s.difference > 0 ? 'over' : 'short') + '">' + (s.difference === 0 ? 'balances' : (s.difference > 0 ? 'over ' : 'short ') + rand(Math.abs(s.difference))) + '</span>') + '</td></tr>').join('') + '</table>' : '') +
    (open.length ? '<p class="error-text">Close the till first (on the Till tab), so all of the day\'s sales are in.</p>' : '') +
    '<button type="button" class="btn-primary pos-inline-btn" id="tillFillBtn">Fill in from the till</button>' +
    '<p class="muted till-cu-note">Fills in: gross sales ' + rand(gross) + ', cash refunds ' + rand(res.cashRefunds) + ', ' + res.cardCount + ' card sales, ' +
      'card total ' + rand(res.cardSales - res.cardRefunds + res.otherSales - res.otherRefunds) + (res.otherSales ? ' (includes EFT / other)' : '') +
      ', cashier names' + (res.sessions.some((s) => s.floatKept !== null) ? ' and the float kept' : '') + '. You still count the cash and add donations and expenses.</p>';
  document.getElementById('tillFillBtn').addEventListener('click', fillCashupFromTill);
}

function fillCashupFromTill() {
  const r = tillCashup;
  if (!r) return;
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.classList.add('from-till'); };
  set('zReadingNo', 'Till ' + r.firstReceipt + ' – ' + r.lastReceipt.split('-').pop());
  set('grossSales', posMoney(r.cashSales + r.cardSales + r.otherSales - r.cardRefunds - r.otherRefunds).toFixed(2));
  set('cashRefundsAmount', posMoney(r.cashRefunds).toFixed(2));
  set('cardSalesCount', r.cardCount);
  set('totalCardSales', posMoney(r.cardSales - r.cardRefunds + r.otherSales - r.otherRefunds).toFixed(2));
  if (r.cashiers.length) set('mCasher', r.cashiers.join(', '));
  const kept = r.sessions.filter((s) => s.floatKept !== null).reduce((t, s) => t + s.floatKept, 0);
  if (r.sessions.some((s) => s.floatKept !== null)) set('floatAmount', posMoney(kept).toFixed(2));
  const refundNote = document.getElementById('refundsExplain');
  if (r.refundCount && !refundNote.value) set('refundsExplain', r.refundCount + ' refund' + (r.refundCount === 1 ? '' : 's') + ' on the till (see the daily sales sheet).');
  recalcAll();
  document.getElementById('tillFillBtn').textContent = 'Filled in ✓ — fill in again';
}

function openAssetCategory(cat) {
  assetCatEditing = cat || null;
  document.getElementById('assetCatTitle').textContent = cat ? 'Edit category' : 'New category';
  document.getElementById('acGroup').innerHTML = assetData.groups.map((g) => '<option>' + escapeHtml(g) + '</option>').join('');
  document.getElementById('acName').value = cat ? cat.name : '';
  document.getElementById('acGroup').value = cat ? cat.group : 'Shared';
  document.getElementById('acTypes').value = cat ? cat.types.join(', ') : '';
  document.getElementById('acLife').value = cat ? cat.usefulLife : 5;
  document.getElementById('acActive').checked = cat ? cat.active : true;
  document.getElementById('acActiveWrap').hidden = !cat;
  document.getElementById('assetCatError').textContent = '';
  document.getElementById('assetCatBackdrop').hidden = false;
  setTimeout(() => document.getElementById('acName').focus(), 50);
}

async function saveAssetCategory() {
  const err = document.getElementById('assetCatError');
  const btn = document.getElementById('assetCatSave');
  const name = document.getElementById('acName').value.trim();
  err.textContent = '';
  if (!name) { err.textContent = 'Give the category a name.'; return; }
  const payload = { requesterEmail: currentUser.email, op: assetCatEditing ? 'update' : 'add', name: name,
    group: document.getElementById('acGroup').value, types: document.getElementById('acTypes').value, life: document.getElementById('acLife').value };
  if (assetCatEditing) { payload.id = assetCatEditing.id; payload.active = document.getElementById('acActive').checked; }
  btn.disabled = true;
  const res = await apiPost('assetCategory', payload);
  btn.disabled = false;
  if (!res.success) { err.textContent = res.error || 'Could not save.'; return; }
  document.getElementById('assetCatBackdrop').hidden = true;
  await loadAssetsPage();
  refreshAssetCategoryFilter();
}

// ── Wiring ──────────────────────────────────────────────────────────

(function wireAssets() {
  const el = (id) => document.getElementById(id);
  document.querySelectorAll('#assetTabs button').forEach((b) => b.addEventListener('click', () => showAssetTab(b.dataset.as)));
  el('assetAddBtn').addEventListener('click', () => openAssetEdit(null));
  el('assetOvLocation').addEventListener('change', renderAssetOverview);
  ['assetSearch', 'assetLocFilter', 'assetCatFilter', 'assetStatusFilter'].forEach((id) =>
    el(id).addEventListener(id === 'assetSearch' ? 'input' : 'change', renderAssetRegister));
  el('view-assets').addEventListener('click', (e) => {
    const row = e.target.closest('[data-asset]');
    if (row) { openAssetDetail(row.dataset.asset); return; }
    const ct = e.target.closest('[data-count]');
    if (ct) { openAssetCount(ct.dataset.count); return; }
    const toReg = (loc, cat, st) => {
      el('assetSearch').value = '';
      el('assetLocFilter').value = loc !== undefined ? loc : el('assetOvLocation').value;
      el('assetCatFilter').value = cat || '';
      el('assetStatusFilter').value = st || 'held';
      showAssetTab('register');
    };
    const loc = e.target.closest('[data-asset-loc]');
    if (loc) { toReg(loc.dataset.assetLoc); return; }
    const cat = e.target.closest('[data-asset-cat]');
    if (cat) { toReg(undefined, cat.dataset.assetCat); return; }
    const st = e.target.closest('[data-asset-status]');
    if (st) { toReg(undefined, '', st.dataset.assetStatus); return; }
    const ce = e.target.closest('[data-asset-cat-edit]');
    if (ce) openAssetCategory(assetData.categories.filter((c) => c.id === ce.dataset.assetCatEdit)[0]);
  });
  el('assetTableBody').addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-asset]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openAssetDetail(row.dataset.asset); }
  });
  el('assetCatAdd').addEventListener('click', () => openAssetCategory(null));
  el('assetDetailClose').addEventListener('click', closeAssetDetail);
  el('assetEditClose').addEventListener('click', () => { el('assetEditBackdrop').hidden = true; });
  el('assetEditCancel').addEventListener('click', () => { el('assetEditBackdrop').hidden = true; });
  el('assetEditSave').addEventListener('click', saveAssetEdit);
  el('aeCategory').addEventListener('change', onAssetCategoryChange);
  el('aeStatus').addEventListener('change', onAssetStatusChange);
  el('aeAcquired').addEventListener('change', onAssetAcquiredChange);
  el('aeFile').addEventListener('change', async (e) => {
    assetFileData = '';
    el('assetEditError').textContent = '';
    try { assetFileData = await readAssetFile(e.target.files[0], true); }
    catch (ex) { el('assetEditError').textContent = ex.message; e.target.value = ''; }
  });
  el('assetReportClose').addEventListener('click', () => { el('assetReportBackdrop').hidden = true; });
  el('assetReportCancel').addEventListener('click', () => { el('assetReportBackdrop').hidden = true; });
  el('assetReportSave').addEventListener('click', saveAssetReport);
  el('arPhoto').addEventListener('change', async (e) => {
    assetReportPhoto = '';
    el('assetReportError').textContent = '';
    try { assetReportPhoto = await readAssetFile(e.target.files[0], false); }
    catch (ex) { el('assetReportError').textContent = ex.message; e.target.value = ''; }
  });
  el('assetCatClose').addEventListener('click', () => { el('assetCatBackdrop').hidden = true; });
  el('assetCatCancel').addEventListener('click', () => { el('assetCatBackdrop').hidden = true; });
  el('assetCatSave').addEventListener('click', saveAssetCategory);
  el('assetFormClose').addEventListener('click', () => { el('assetFormBackdrop').hidden = true; });
  el('assetFormCancel').addEventListener('click', () => { el('assetFormBackdrop').hidden = true; });
  el('assetFormSave').addEventListener('click', submitAssetForm);
  el('assetCtStart').addEventListener('click', startAssetCountClick);
  el('assetPrintBtn').addEventListener('click', printAssetRegister);
  el('assetCountClose').addEventListener('click', () => { el('assetCountBackdrop').hidden = true; assetCountOpen = null; if (assetTab === 'counts') loadAssetsPage(); });
  ['assetDetailBackdrop', 'assetEditBackdrop', 'assetReportBackdrop', 'assetCatBackdrop', 'assetFormBackdrop', 'assetCountBackdrop'].forEach((id) => {
    if (id === 'assetDetailBackdrop') el(id).addEventListener('click', (e) => { if (e.target.id === id) closeAssetDetail(); });
    else guardModalBackdrop(id);
  });
})();

// ─────────────────────────────────────────────────────────────────────
// TILL / POINT OF SALE (Pro feature "pos") — Phase 1
//
// Every sale is saved on this device first (localStorage) and a receipt can
// print straight away; a background sync sends the queue to the server and
// clears what it accepted. So the till keeps selling when the internet or
// Google is slow or down. Receipt numbers are made here: BRANCH-T<till>-n.
// ─────────────────────────────────────────────────────────────────────

let posCfg = null;          // posConfig response (or the cached copy when offline)
let posTab = 'sell';
let posSale = { lines: [], method: 'Cash' };
let posEditing = -1;        // line index being edited, or -1 for a new line
let posEditCat = null;      // category of the line editor
let posSyncing = false;
let posSyncTimer = null;
let posOffline = false;
let posLastDone = null;     // the sale just completed (for Print receipt)
let posPin = '';
let posDialogOk = null;
let posSheetData = null;

function posKey(name) { return 'pos_' + name + ':' + (currentUser ? normEmailClient(currentUser.email) : ''); }
function normEmailClient(e) { return String(e || '').trim().toLowerCase(); }
function posRead(name, fallback) {
  try { const v = localStorage.getItem(name); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function posWrite(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)); return true; } catch (e) { return false; }
}
function posDevice() {
  return Object.assign({ till: 1, autoPrint: false, mode: 'auto', paper: 80 }, posRead('pos_device', {}));
}
function posQueue() { return posRead(posKey('queue'), []); }
function posSetQueue(q) {
  if (!posWrite(posKey('queue'), q)) showPosError('This device is out of storage space. Sales can\'t be saved until it has synced — check the internet connection.');
}
function posRecent() { return posRead(posKey('recent'), []); }
function posSetRecent(list) { posWrite(posKey('recent'), list.slice(0, 200)); }
function posBranchNow() { return posCfg ? posCfg.branch : ''; }
function posNowString(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function posUid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 's' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
function posMoney(n) { return Math.round(Number(n || 0) * 100) / 100; }
function showPosError(msg) {
  const el = document.getElementById('posError');
  el.textContent = msg || ''; el.hidden = !msg;
}

// ── Loading ─────────────────────────────────────────────────────────

async function loadTillPage(wantedBranch) {
  applyPosMode();
  const cached = posRead(posKey('cfg'), null);
  const branch = wantedBranch || (cached && cached.branch) || '';
  if (!posCfg && cached) posCfg = cached;
  document.getElementById('posLoading').hidden = !!posCfg;
  if (posCfg) renderTill();
  const res = await apiGet('posConfig', { email: currentUser.email, branch: branch });
  if (!res.success) {
    if (res.networkError && posCfg) { posOffline = true; renderPosSync(); return; }
    document.getElementById('posLoading').hidden = true;
    showPosError(res.error === 'Unknown action' ? 'The till needs the updated Apps Script. Ask a developer to redeploy it.' : (res.error || 'Could not load the till.'));
    return;
  }
  posOffline = false;
  posCfg = res;
  posWrite(posKey('cfg'), res);
  rememberOfflineUser();
  document.getElementById('posLoading').hidden = true;
  showPosError('');
  renderTill();
  posSyncNow();
  if (!posSyncTimer) posSyncTimer = setInterval(() => { if (currentPage === 'till') posSyncNow(); }, 30000);
}

// Lets the till open again without internet (the rest of the app needs it).
function rememberOfflineUser() {
  const u = {};
  ['email', 'fullName', 'role', 'branch', 'status', 'features'].forEach((k) => { u[k] = currentUser[k]; });
  posWrite('pos_offline_user', u);
}

function renderTill() {
  const d = posCfg;
  const sel = document.getElementById('posBranch');
  sel.hidden = !d.canSell || d.branches.length < 2;
  sel.innerHTML = d.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
  sel.value = d.branch;
  document.getElementById('posTillChip').textContent = (d.branch ? d.branch + ' · ' : '') + 'Till ' + posDevice().till;
  document.getElementById('posTillChip').hidden = !d.canSell;
  document.getElementById('posCashierBtn').hidden = !d.canSell;
  document.getElementById('posSync').hidden = !d.canSell;
  document.getElementById('posSellTabBtn').hidden = !d.canSell;
  document.getElementById('posCashTabBtn').hidden = !d.canCashiers;
  document.getElementById('posSetTabBtn').hidden = !d.canSell && !d.canManage;
  if (!d.canSell && (posTab === 'sell' || posTab === 'cashiers')) posTab = 'sheet';
  renderPosCashier();
  renderPosSync();
  showPosTab(posTab);
}

function showPosTab(tab) {
  posTab = tab;
  document.querySelectorAll('#posTabs button').forEach((b) => b.classList.toggle('active', b.dataset.pt === tab));
  ['sell', 'sheet', 'cashiers', 'settings'].forEach((t) => { document.getElementById('pt-' + t).hidden = t !== tab; });
  if (tab === 'sell') renderPosSell();
  else if (tab === 'sheet') loadPosSheet();
  else if (tab === 'cashiers') loadPosCashiers();
  else renderPosSettings();
}

function applyPosMode() {
  const mode = posDevice().mode;
  document.body.classList.toggle('pos-touch', mode === 'touch');
  document.body.classList.toggle('pos-desktop', mode === 'desktop');
}

// ── Cashier ─────────────────────────────────────────────────────────

function posCashier() {
  const c = posRead(posKey('cashier'), null);
  if (c && c.branch === posBranchNow() && (!c.id || posCfg.cashiers.some((x) => x.id === c.id))) return c;
  return { id: '', name: posCfg && posCfg.me ? posCfg.me.name : currentUser.fullName, branch: posBranchNow() };
}
function renderPosCashier() {
  document.getElementById('posCashierBtn').textContent = 'Cashier: ' + posCashier().name;
}
function openPosPin() {
  posPin = '';
  document.getElementById('posPinError').textContent = '';
  document.getElementById('posPinHint').textContent = posCfg.cashiers.length ? 'Enter your 4-digit till PIN.' : 'No cashier PINs are set up for this branch yet (see the Cashiers tab).';
  document.getElementById('posPinMe').textContent = 'Use ' + (posCfg.me ? posCfg.me.name : 'my own name') + ' (signed in)';
  document.getElementById('posPinPad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']
    .map((k) => '<button type="button" data-pin="' + k + '">' + k + '</button>').join('');
  renderPinDots();
  document.getElementById('posPinBackdrop').hidden = false;
}
function renderPinDots() {
  document.querySelectorAll('#posPinDots span').forEach((s, i) => s.classList.toggle('on', i < posPin.length));
}
async function posSha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function pinKey(k) {
  if (k === 'C') posPin = '';
  else if (k === '⌫') posPin = posPin.slice(0, -1);
  else if (posPin.length < 4) posPin += k;
  renderPinDots();
  document.getElementById('posPinError').textContent = '';
  if (posPin.length < 4) return;
  const pin = posPin;
  let match = null;
  for (const c of posCfg.cashiers) { if ((await posSha256(c.salt + ':' + pin)) === c.hash) { match = c; break; } }
  posPin = '';
  renderPinDots();
  if (!match) { document.getElementById('posPinError').textContent = 'That PIN is not right. Try again.'; return; }
  posWrite(posKey('cashier'), { id: match.id, name: match.name, branch: posBranchNow() });
  document.getElementById('posPinBackdrop').hidden = true;
  renderPosCashier();
}

// ── Selling ─────────────────────────────────────────────────────────

function renderPosSell() {
  const cats = posCfg.categories.filter((c) => c.active);
  document.getElementById('posCats').innerHTML = cats.map((c) =>
    '<button type="button" class="pos-cat" data-cat="' + escapeAttr(c.id) + '"><span class="pos-cat-name">' + escapeHtml(c.name) + '</span>' +
    (c.defaultPrice !== null ? '<span class="pos-cat-price">' + rand(c.defaultPrice) + '</span>' : '') + '</button>').join('');
  document.getElementById('posMethods').innerHTML = posCfg.methods.map((m) =>
    '<button type="button" class="pos-method' + (posSale.method === m ? ' is-on' : '') + '" data-method="' + escapeAttr(m) + '">' + escapeHtml(m) + '</button>').join('');
  renderPosSale();
  renderPosRecent();
  renderPosSessionState();
}

function posSaleTotal() { return posMoney(posSale.lines.reduce((t, l) => t + posMoney(l.qty * l.price), 0)); }

function renderPosSale() {
  const total = posSaleTotal();
  const items = posSale.lines.reduce((t, l) => t + l.qty, 0);
  document.getElementById('posLines').innerHTML = posSale.lines.length ? posSale.lines.map((l, i) =>
    '<button type="button" class="pos-line" data-line="' + i + '"><span class="pos-line-desc"><strong>' + l.qty + ' × ' + escapeHtml(l.categoryName) + '</strong>' +
    (l.description ? '<span class="muted">' + escapeHtml(l.description) + '</span>' : '') + '<span class="muted">@ ' + rand(l.price) + '</span></span>' +
    '<span class="pos-line-amt">' + rand(posMoney(l.qty * l.price)) + '</span></button>').join('')
    : '<p class="muted pos-empty">Tap a category to add an item.</p>';
  document.getElementById('posItemCount').textContent = items;
  document.getElementById('posItemWord').textContent = items === 1 ? 'item' : 'items';
  document.getElementById('posTotal').textContent = rand(total);
  document.getElementById('posClearBtn').hidden = !posSale.lines.length;
  document.querySelectorAll('#posMethods .pos-method').forEach((b) => b.classList.toggle('is-on', b.dataset.method === posSale.method));
  const cash = posSale.method === 'Cash';
  document.getElementById('posCashBox').hidden = !cash;
  if (cash) {
    const notes = [10, 20, 50, 100, 200, 500].filter((n) => n > total).slice(0, 3);
    document.getElementById('posQuick').innerHTML = '<button type="button" data-cash="exact">Exact</button>' +
      notes.map((n) => '<button type="button" data-cash="' + n + '">R' + n + '</button>').join('');
  }
  updatePosChange();
}

function updatePosChange() {
  const total = posSaleTotal();
  const raw = document.getElementById('posCashIn').value;
  const cash = raw === '' ? total : posMoney(raw);
  const short = posSale.method === 'Cash' && raw !== '' && cash < total;
  document.getElementById('posChange').textContent = short ? 'R ' + (total - cash).toFixed(2) + ' short' : rand(Math.max(0, cash - total));
  document.getElementById('posChange').classList.toggle('is-short', short);
  document.getElementById('posComplete').disabled = !posSale.lines.length || short;
  document.getElementById('posComplete').textContent = posSale.lines.length ? 'Complete sale · ' + rand(total) : 'Complete sale';
}

function openPosLine(catId, index) {
  posEditing = index === undefined ? -1 : index;
  const line = posEditing >= 0 ? posSale.lines[posEditing] : null;
  const cat = line ? posCfg.categories.filter((c) => c.id === line.categoryId)[0] || null : posCfg.categories.filter((c) => c.id === catId)[0] || null;
  posEditCat = cat;
  const other = !cat || /^other$/i.test(cat.name);
  document.getElementById('posLineTitle').textContent = cat ? cat.name : 'Something else';
  document.getElementById('plQty').value = line ? line.qty : 1;
  document.getElementById('plPrice').value = line ? line.price : (cat && cat.defaultPrice !== null ? cat.defaultPrice : '');
  document.getElementById('plDesc').value = line ? line.description : '';
  document.getElementById('plDescLabel').textContent = other ? 'What is it?' : 'Description (optional)';
  document.getElementById('plRemove').hidden = !line;
  document.getElementById('plSave').textContent = line ? 'Update' : 'Add to sale';
  document.getElementById('plError').textContent = '';
  updatePosLineTotal();
  document.getElementById('posLineBackdrop').hidden = false;
  const focusEl = document.getElementById(other && !line ? 'plDesc' : 'plPrice');
  focusEl.focus();
  if (focusEl.select) focusEl.select();
}

function updatePosLineTotal() {
  const q = Number(document.getElementById('plQty').value) || 0;
  const p = Number(document.getElementById('plPrice').value) || 0;
  document.getElementById('plTotal').textContent = rand(posMoney(q * p));
}

function savePosLine() {
  const err = document.getElementById('plError');
  const qty = Number(document.getElementById('plQty').value);
  const priceRaw = document.getElementById('plPrice').value;
  const price = posMoney(priceRaw);
  const description = document.getElementById('plDesc').value.trim();
  const other = !posEditCat || /^other$/i.test(posEditCat.name);
  if (!(qty >= 1 && qty <= 999 && Math.round(qty) === qty)) { err.textContent = 'Quantity must be a whole number from 1 to 999.'; return; }
  if (priceRaw === '' || !(price >= 0 && price <= 1000000)) { err.textContent = 'Enter the price for one item.'; return; }
  if (other && !description) { err.textContent = 'Say what it is, e.g. "Defy fridge".'; return; }
  const line = { categoryId: posEditCat ? posEditCat.id : '', categoryName: posEditCat ? posEditCat.name : 'Other', qty: qty, price: price, description: description };
  if (posEditing >= 0) posSale.lines[posEditing] = line; else posSale.lines.push(line);
  document.getElementById('posLineBackdrop').hidden = true;
  posHideDone();
  renderPosSale();
}

function posHideDone() {
  document.getElementById('posDone').hidden = true;
  document.querySelector('.pos-sale').hidden = false;
}

async function completePosSale() {
  const err = document.getElementById('posSaleError');
  err.textContent = '';
  if (!posSale.lines.length) return;
  const total = posSaleTotal();
  const cashRaw = document.getElementById('posCashIn').value;
  const cash = posSale.method === 'Cash' ? (cashRaw === '' ? total : posMoney(cashRaw)) : null;
  if (cash !== null && cash < total) { err.textContent = 'Cash received is less than the total.'; return; }
  const session = posCurrentSession();
  if (!session) { renderPosSessionState(); return; }
  const dev = posDevice();
  const branch = posBranchNow();
  const code = posCfg.codes[branch] || 'BR';
  const seqKey = 'pos_seq:' + branch + ':' + dev.till;
  const seq = Math.max(Number(posRead(seqKey, 0)) || 0, Number((posCfg.lastSeq || {})[String(dev.till)]) || 0) + 1;
  const cashier = posCashier();
  const sale = {
    uid: posUid(), receiptNo: code + '-T' + dev.till + '-' + String(seq).padStart(6, '0'), till: dev.till, time: posNowString(),
    cashierId: cashier.id, cashierName: cashier.name, method: posSale.method, total: total,
    cashReceived: cash, change: cash !== null ? posMoney(cash - total) : null, sessionId: session.id,
    lines: posSale.lines.map((l) => ({ categoryId: l.categoryId, categoryName: l.categoryName, qty: l.qty, price: l.price, description: l.description }))
  };
  const q = posQueue();
  q.push({ opId: 'o-' + sale.uid, type: 'sale', branch: branch, sale: sale });
  posSetQueue(q);
  posWrite(seqKey, seq);
  const recent = posRecent();
  recent.unshift(Object.assign({ branch: branch, status: 'Completed', sent: false }, sale));
  posSetRecent(recent);
  posLastDone = Object.assign({ branch: branch }, sale);
  posSale = { lines: [], method: 'Cash' };
  document.getElementById('posCashIn').value = '';
  document.querySelector('.pos-sale').hidden = true;
  document.getElementById('posDone').hidden = false;
  document.getElementById('posDoneChange').textContent = sale.change !== null && sale.change > 0 ? 'Change: ' + rand(sale.change) : rand(total) + ' · ' + sale.method;
  document.getElementById('posDoneRef').textContent = sale.receiptNo + ' · ' + sale.cashierName;
  renderPosSale();
  renderPosRecent();
  if (dev.autoPrint) printPosReceipt(posLastDone, false);
  setTimeout(() => document.getElementById('posNewSale').focus(), 30);
  posSyncNow();
}

function renderPosRecent() {
  const today = posNowString().slice(0, 10);
  const branch = posBranchNow();
  const list = posRecent().filter((s) => s.branch === branch && s.time.slice(0, 10) === today);
  const totals = list.filter((s) => s.status !== 'Cancelled').reduce((t, s) => t + s.total, 0);
  const nSales = list.filter((s) => s.kind !== 'Refund').length;
  document.getElementById('posRecent').innerHTML = list.length ? '<p class="muted pos-recent-sum">' + nSales + ' sale' + (nSales === 1 ? '' : 's') + ' · ' + rand(totals) + ' after refunds (not counting cancelled)</p>' +
    list.map((s) => '<div class="fin-line' + (s.status === 'Cancelled' ? ' pos-cancelled' : '') + (s.kind === 'Refund' ? ' pos-is-refund' : '') + '"><span class="fin-line-main">' +
      '<span class="fin-line-desc">' + escapeHtml(s.time.slice(11, 16)) + ' · ' + escapeHtml(s.receiptNo) + ' · ' + (s.kind === 'Refund' ? '<strong>Refund of ' + escapeHtml(s.refundOfReceipt || '') + ':</strong> ' : '') +
      escapeHtml(s.lines.map((l) => l.qty + '× ' + (l.description || l.categoryName)).join(', ')) + '</span>' +
      '<span class="fin-line-meta">' + escapeHtml(s.method) + ' · ' + escapeHtml(s.cashierName) + ' · ' + (s.sent ? 'sent' : '<strong>waiting to send</strong>') +
      (s.status === 'Cancelled' ? ' · cancelled: ' + escapeHtml(s.cancelReason || '') : '') + '</span></span>' +
      '<span class="fin-line-side"><span class="fin-line-amt">' + rand(s.total) + '</span>' +
      '<button type="button" class="link-btn" data-reprint="' + escapeAttr(s.uid) + '">Reprint</button>' +
      (s.status !== 'Cancelled' && s.kind !== 'Refund' ? '<button type="button" class="link-btn" data-refund="' + escapeAttr(s.receiptNo) + '">Refund</button>' : '') +
      (s.status !== 'Cancelled' ? '<button type="button" class="link-btn asset-file-rm" data-void="' + escapeAttr(s.uid) + '">' + (s.kind === 'Refund' ? 'Cancel refund' : 'Cancel sale') + '</button>' : '') +
      '</span></div>').join('') : '<p class="muted">No sales on this till yet today.</p>';
}

function openPosVoid(uid) {
  const s = posRecent().filter((x) => x.uid === uid)[0];
  if (!s) return;
  openPosDialog({
    title: s.kind === 'Refund' ? 'Cancel refund' : 'Cancel sale', sub: s.receiptNo + ' · ' + rand(s.total) + ' · ' + s.method,
    body: '<p class="muted">' + (s.kind === 'Refund' ? 'Use this if the refund was entered by mistake. It stays on record, marked as cancelled. ' +
      (s.method === 'Cash' ? 'The ' + rand(-s.total) + ' cash should go back in the drawer.' : '')
      : 'The sale stays on record, marked as cancelled, and is left out of the totals. ' +
      (s.method === 'Cash' ? 'Give back the ' + rand(s.total) + ' cash if the customer paid.' : 'Reverse the card payment on the card machine if needed.')) + '</p>' +
      '<label>Reason <input type="text" id="pdReason" maxlength="300" placeholder="e.g. rang up twice, customer changed mind"></label>',
    ok: 'Cancel sale',
    onOk: () => {
      const reason = document.getElementById('pdReason').value.trim();
      if (!reason) return 'Give a reason.';
      const q = posQueue();
      q.push({ opId: 'v-' + uid, type: 'void', branch: s.branch, uid: uid, reason: reason, at: posNowString(), by: posCashier().name });
      posSetQueue(q);
      posSetRecent(posRecent().map((x) => (x.uid === uid ? Object.assign(x, { status: 'Cancelled', cancelReason: reason }) : x)));
      renderPosRecent();
      posSyncNow();
      return '';
    }
  });
}

// ── Sync ────────────────────────────────────────────────────────────

function renderPosSync() {
  const el = document.getElementById('posSync');
  if (!el) return;
  const n = posQueue().length;
  el.classList.toggle('is-wait', n > 0);
  el.classList.toggle('is-off', posOffline);
  el.textContent = posOffline ? (n ? 'Offline · ' + n + ' waiting' : 'Offline') : (n ? n + ' waiting to send' : 'All sent ✓');
  const rej = posRead(posKey('rejected'), []);
  if (rej.length) showPosError(rej.length + ' sale change' + (rej.length === 1 ? ' was' : 's were') + ' not accepted: ' + rej.slice(-1)[0].error + ' (ask a developer to check).');
}

async function posSyncNow() {
  if (posSyncing || !posCfg || !posCfg.canSell) { renderPosSync(); return; }
  let q = posQueue();
  if (!q.length) { renderPosSync(); return; }
  posSyncing = true;
  try {
    while (q.length) {
      const branch = q[0].branch;
      const batch = q.filter((op) => op.branch === branch).slice(0, 40);
      const res = await apiPost('posSync', { requesterEmail: currentUser.email, branch: branch,
        ops: batch.map((op) => Object.assign({}, op, { branch: undefined })) });
      if (!res.success) { posOffline = !!res.networkError; if (!res.networkError) showPosError(res.error || 'Could not send sales.'); break; }
      posOffline = false;
      const done = {}; (res.done || []).forEach((id) => { done[id] = true; });
      const bad = {}; (res.rejected || []).forEach((r) => { bad[r.opId] = r.error; });
      if (Object.keys(bad).length) posWrite(posKey('rejected'), posRead(posKey('rejected'), []).concat(batch.filter((op) => bad[op.opId]).map((op) => ({ op: op, error: bad[op.opId] }))));
      const sentUids = {};
      batch.forEach((op) => { if (done[op.opId] && op.type === 'sale') sentUids[op.sale.uid] = true; });
      q = posQueue().filter((op) => !done[op.opId] && !bad[op.opId]);
      posSetQueue(q);
      posSetRecent(posRecent().map((s) => (sentUids[s.uid] ? Object.assign(s, { sent: true }) : s)));
      if (!(res.done || []).length && !(res.rejected || []).length) break;
    }
  } finally {
    posSyncing = false;
    renderPosSync();
    if (posTab === 'sell' && currentPage === 'till') renderPosRecent();
  }
}

// ── Receipts ────────────────────────────────────────────────────────

function posReceiptHtml(sale, copy) {
  const e = escapeHtml;
  const dev = posDevice();
  const w = dev.paper === 58 ? 48 : 72; // printable width in mm
  const logo = new URL('assets/logo.jpg', location.href).href;
  const rc = posCfg.receipt || {};
  const money = (v) => 'R' + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isRefund = sale.kind === 'Refund';
  const sign = isRefund ? '-' : '';
  const lines = sale.lines.map((l) => '<tr><td colspan="2">' + e(l.qty + ' × ' + (l.description ? l.categoryName + ' – ' + l.description : l.categoryName)) + '</td></tr>' +
    '<tr><td class="sm">@ ' + money(l.price) + '</td><td class="r">' + sign + money(posMoney(l.qty * l.price)) + '</td></tr>').join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(sale.receiptNo) + '</title><style>' +
    '@page{size:' + (dev.paper === 58 ? 58 : 80) + 'mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}' +
    'body{width:' + w + 'mm;margin:0 auto;padding:3mm 0 6mm;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#000}' +
    '.c{text-align:center}.r{text-align:right;white-space:nowrap}.sm{font-size:10px;padding-left:3mm}img{display:block;margin:0 auto 2mm;max-width:38mm;max-height:16mm;filter:grayscale(1)}' +
    'h1{font-size:13px;margin:0}.hd{white-space:pre-line;font-size:10.5px}hr{border:0;border-top:1px dashed #000;margin:2mm 0}' +
    'table{width:100%;border-collapse:collapse}td{padding:0.4mm 0;vertical-align:top}.tot td{font-size:15px;font-weight:bold;padding-top:1mm}' +
    '.copy{border:1.5px solid #000;text-align:center;font-weight:bold;padding:1mm;margin-bottom:2mm}.ft{white-space:pre-line;font-size:10.5px}' +
    '.void{border:2px solid #000;text-align:center;font-weight:bold;font-size:14px;padding:1mm;margin:2mm 0}</style></head><body>' +
    (copy ? '<div class="copy">COPY — REPRINTED</div>' : '') +
    '<img src="' + e(logo) + '" alt=""><div class="c hd"><h1>' + e((rc.header || '').split('\n')[0]) + '</h1>' + e((rc.header || '').split('\n').slice(1).join('\n')) + '</div>' +
    '<div class="c">' + e(sale.branch || posBranchNow()) + '</div><hr>' +
    (isRefund ? '<div class="void">REFUND</div><div class="c">Refund of ' + e(sale.refundOfReceipt || '') + '</div><div class="c sm">' + e(sale.reason || sale.refundReason || '') + '</div><hr>' : '') +
    '<table><tr><td>Receipt</td><td class="r">' + e(sale.receiptNo) + '</td></tr><tr><td>Date</td><td class="r">' + e(assetWhen(sale.time.slice(0, 16))) + '</td></tr>' +
    '<tr><td>Cashier</td><td class="r">' + e(sale.cashierName) + '</td></tr></table><hr>' +
    '<table>' + lines + '</table><hr>' +
    '<table><tr class="tot"><td>' + (isRefund ? 'REFUNDED' : 'TOTAL') + '</td><td class="r">' + money(Math.abs(sale.total)) + '</td></tr>' +
    '<tr><td>' + (isRefund ? 'Refunded by' : 'Paid by') + '</td><td class="r">' + e(sale.method) + '</td></tr>' +
    (sale.cashReceived !== null && sale.cashReceived !== undefined ? '<tr><td>Cash received</td><td class="r">' + money(sale.cashReceived) + '</td></tr><tr><td>Change</td><td class="r">' + money(sale.change || 0) + '</td></tr>' : '') +
    '<tr><td>Items</td><td class="r">' + sale.lines.reduce((t, l) => t + l.qty, 0) + '</td></tr></table>' +
    (sale.status === 'Cancelled' ? '<div class="void">CANCELLED</div>' : '') + '<hr>' +
    '<div class="c ft">' + e(rc.footer || '') + '</div></body></html>';
}

function printPosReceipt(sale, copy) {
  const frame = document.getElementById('posPrintFrame');
  frame.onload = () => {
    frame.onload = null;
    const img = frame.contentDocument.querySelector('img');
    const go = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* ignore */ } };
    if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 1500); } else go();
  };
  frame.srcdoc = posReceiptHtml(sale, copy);
}

// ── Daily sales sheet ───────────────────────────────────────────────

async function loadPosSheet() {
  const d = posCfg;
  const bsel = document.getElementById('posSheetBranch');
  const branches = d.branches;
  if (!bsel.options.length) {
    bsel.innerHTML = branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join('');
    bsel.value = d.branch || branches[0];
  }
  document.getElementById('posSheetBranchWrap').hidden = branches.length < 2;
  const dateIn = document.getElementById('posSheetDate');
  if (!dateIn.value) dateIn.value = d.today || posNowString().slice(0, 10);
  const body = document.getElementById('posSheetBody');
  body.innerHTML = '<p class="muted">Loading…</p>';
  const branch = bsel.value, date = dateIn.value;
  const res = await apiGet('posDay', { email: currentUser.email, branch: branch, date: date });
  if (bsel.value !== branch || dateIn.value !== date) return;
  // Sales on this device that haven't reached the server yet are shown too.
  const known = {};
  const sales = res.success ? res.sales.slice() : [];
  sales.forEach((s) => { known[s.uid] = s; });
  const local = posRecent().filter((s) => s.branch === branch && s.time.slice(0, 10) === date);
  local.forEach((s) => {
    if (known[s.uid]) { if (s.status === 'Cancelled' && known[s.uid].status !== 'Cancelled') Object.assign(known[s.uid], { status: 'Cancelled', cancelReason: s.cancelReason, pending: true }); return; }
    sales.push(Object.assign(posLocalAsServer(s), { pending: true }));
  });
  if (!res.success && !local.length) {
    body.innerHTML = '<p class="error-text">' + escapeHtml(res.networkError ? 'You are offline. Only sales made on this device are shown once you reconnect.' : res.error || 'Could not load the sheet.') + '</p>';
    posSheetData = null;
    return;
  }
  sales.sort((a, b) => (a.time < b.time ? -1 : 1));
  posSheetData = { branch: branch, date: date, sales: sales, offline: !res.success, sessions: res.success ? (res.sessions || []) : [] };
  body.innerHTML = posSheetHtml(posSheetData, false);
}

function posSheetSummary(data) {
  const live = data.sales.filter((s) => s.status !== 'Cancelled');
  const sum = { total: 0, items: 0, sales: live.filter((s) => s.kind !== 'Refund').length, methods: {}, cats: {}, cancelled: data.sales.length - live.length,
    cancelledValue: 0, refunds: live.filter((s) => s.kind === 'Refund').length, refundValue: 0, cashiers: {} };
  live.forEach((s) => {
    sum.total += s.total; sum.methods[s.method] = (sum.methods[s.method] || 0) + s.total;
    const c = sum.cashiers[s.cashierName || '—'] = sum.cashiers[s.cashierName || '—'] || { sales: 0, total: 0, refunds: 0, cancelled: 0 };
    if (s.kind === 'Refund') { sum.refundValue += -s.total; c.refunds += -s.total; } else { c.sales++; }
    c.total += s.total;
    s.lines.forEach((l) => { sum.items += l.qty; const k = l.category || 'Other'; sum.cats[k] = sum.cats[k] || { qty: 0, amt: 0 }; sum.cats[k].qty += l.qty; sum.cats[k].amt += l.lineTotal; });
  });
  data.sales.filter((s) => s.status === 'Cancelled').forEach((s) => {
    sum.cancelledValue += s.total;
    const c = sum.cashiers[s.cashierName || '—'] = sum.cashiers[s.cashierName || '—'] || { sales: 0, total: 0, refunds: 0, cancelled: 0 };
    c.cancelled++;
  });
  sum.total = posMoney(sum.total);
  return sum;
}

function posSheetHtml(data, forPrint) {
  const e = escapeHtml;
  const sum = posSheetSummary(data);
  const rows = [];
  data.sales.forEach((s) => s.lines.forEach((l, i) => rows.push('<tr class="' + (s.status === 'Cancelled' ? 'pos-x' : '') + (s.kind === 'Refund' ? ' pos-rf' : '') + '">' +
    '<td class="n">' + l.qty + '</td><td>' + (s.kind === 'Refund' && i === 0 ? '<strong>Refund' + (s.refundReason || s.reason ? ' (' + e(s.refundReason || s.reason) + ')' : '') + ':</strong> ' : '') +
    e(l.category + (l.description ? ' – ' + l.description : '')) +
    (i === 0 && s.status === 'Cancelled' ? ' <em>(cancelled: ' + e(s.cancelReason || '') + ')</em>' : '') + '</td>' +
    '<td>' + e(s.time.slice(11, 16)) + '</td><td class="n">' + rand(l.lineTotal) + '</td>' +
    '<td class="sm">' + (i === 0 ? e(s.receiptNo) + (s.pending ? ' *' : '') : '') + '</td><td class="sm">' + (i === 0 ? e(s.method) : '') + '</td>' +
    '<td class="sm">' + (i === 0 ? e(s.cashierName) : '') + '</td></tr>')));
  const methods = Object.keys(sum.methods).map((m) => '<tr><td>' + e(m) + '</td><td class="n">' + rand(sum.methods[m]) + '</td></tr>').join('');
  const cats = Object.keys(sum.cats).sort((a, b) => sum.cats[b].amt - sum.cats[a].amt)
    .map((k) => '<tr><td>' + e(k) + '</td><td class="n">' + sum.cats[k].qty + '</td><td class="n">' + rand(sum.cats[k].amt) + '</td></tr>').join('');
  return (forPrint ? '' : '<p class="muted">' + e(data.branch) + ' · ' + e(assetWhen(data.date)) + (data.offline ? ' · <strong>offline — showing this device only</strong>' : '') + '</p>') +
    '<div class="fin-kpis pos-kpis"><div class="kpi-card"><span class="kpi-label">Daily sales total</span><span class="kpi-value">' + rand(sum.total) + '</span></div>' +
    '<div class="kpi-card"><span class="kpi-label">Items sold</span><span class="kpi-value">' + sum.items + '</span></div>' +
    '<div class="kpi-card"><span class="kpi-label">Sales</span><span class="kpi-value">' + sum.sales + '</span></div></div>' +
    (rows.length ? '<div class="pos-sheet-wrap"><table class="pos-sheet"><thead><tr><th class="n">Qty</th><th>Description</th><th>Time</th><th class="n">Amount</th><th>Receipt</th><th>Paid</th><th>Cashier</th></tr></thead><tbody>' +
      rows.join('') + '</tbody><tfoot><tr><td class="n">' + sum.items + '</td><td>Total</td><td></td><td class="n">' + rand(sum.total) + '</td><td colspan="3"></td></tr></tfoot></table></div>'
      : '<p class="muted">No sales on this day.</p>') +
    (rows.length ? '<div class="pos-sheet-cols"><div><h3>By payment</h3><table class="pos-mini">' + methods + '</table>' +
      (sum.refunds ? '<p class="muted">Includes ' + sum.refunds + ' refund' + (sum.refunds === 1 ? '' : 's') + ' (' + rand(sum.refundValue) + ').</p>' : '') +
      (sum.cancelled ? '<p class="muted">' + sum.cancelled + ' cancelled sale' + (sum.cancelled === 1 ? '' : 's') + ' (' + rand(sum.cancelledValue) + ') not counted.</p>' : '') +
      '<h3>By cashier</h3><table class="pos-mini"><tr><th>Cashier</th><th class="n">Sales</th><th class="n">Refunds</th><th class="n">Cancelled</th><th class="n">Net</th></tr>' +
      Object.keys(sum.cashiers).map((k) => { const c = sum.cashiers[k]; return '<tr><td>' + e(k) + '</td><td class="n">' + c.sales + '</td><td class="n">' + (c.refunds ? rand(c.refunds) : '—') +
        '</td><td class="n">' + (c.cancelled || '—') + '</td><td class="n">' + rand(c.total) + '</td></tr>'; }).join('') + '</table></div>' +
      '<div><h3>By category</h3><table class="pos-mini"><tr><th>Category</th><th class="n">Qty</th><th class="n">Amount</th></tr>' + cats + '</table></div></div>' : '') +
    (data.sessions && data.sessions.length ? '<h3 class="pos-sess-h">Tills opened and closed</h3><table class="pos-mini"><tr><th>Till</th><th>Opened</th><th class="n">Float</th><th>Closed</th><th class="n">Expected</th><th class="n">Counted</th><th class="n">Over / short</th></tr>' +
      data.sessions.map((x) => '<tr><td>' + x.till + '</td><td>' + e(x.openedAt.slice(11, 16)) + ' ' + e(x.openedBy) + '</td><td class="n">' + rand(x.float) + '</td><td>' +
        (x.status === 'Closed' ? e(x.closedAt.slice(11, 16)) + ' ' + e(x.closedBy) : '<strong>still open</strong>') + '</td><td class="n">' + (x.expected !== null ? rand(x.expected) : '') + '</td><td class="n">' +
        (x.counted !== null ? rand(x.counted) : '') + '</td><td class="n">' + (x.difference !== null ? (x.difference === 0 ? 'balances' : (x.difference > 0 ? 'over ' : 'short ') + rand(Math.abs(x.difference))) : '') + '</td></tr>' +
        (x.note ? '<tr><td></td><td colspan="6" class="muted">' + e(x.note) + '</td></tr>' : '')).join('') + '</table>' : '') +
    (data.sales.some((s) => s.pending) ? '<p class="muted">* still on this device, waiting to be sent.</p>' : '');
}

function printPosSheet() {
  if (!posSheetData) return;
  const sub = posSheetData.branch + ' · ' + assetWhen(posSheetData.date);
  openReportViewer('Daily sales sheet', sub, assetPrintDoc('Daily sales sheet', sub,
    '<style>.pos-x td{text-decoration:line-through;color:#888}.n{text-align:right;white-space:nowrap}.sm{font-size:10px;color:#5e6a7a}' +
    '.fin-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}.kpi-card{border:1px solid #dfe5ee;border-radius:8px;padding:6px 10px}' +
    '.kpi-label{display:block;font-size:9.5px;color:#5e6a7a;text-transform:uppercase;font-weight:bold}.kpi-value{font-size:18px;font-weight:bold}' +
    '.pos-sheet-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:10px}h3{font-size:11px;color:#0d53af;text-transform:uppercase;margin:8px 0 4px}' +
    'tfoot td{font-weight:bold;border-top:2px solid #142132}</style>' + posSheetHtml(posSheetData, true) +
    '<div class="sig"><div>Cashier</div><div>Store Manager</div><div>Date</div></div>'));
}

async function excelPosSheet() {
  if (!posSheetData) return;
  await loadScriptOnce('vendor/xlsx.full.min.js');
  const aoa = [['Daily sales sheet', posSheetData.branch, posSheetData.date], [], ['Qty', 'Description', 'Time', 'Amount', 'Receipt', 'Payment', 'Cashier', 'Status']];
  posSheetData.sales.forEach((s) => s.lines.forEach((l) => aoa.push([l.qty, l.category + (l.description ? ' – ' + l.description : ''), s.time.slice(11, 16), l.lineTotal,
    s.receiptNo, s.method, s.cashierName, s.status === 'Cancelled' ? 'Cancelled: ' + (s.cancelReason || '') : 'Completed'])));
  const sum = posSheetSummary(posSheetData);
  aoa.push([], [sum.items, 'Total (excluding cancelled)', '', sum.total]);
  Object.keys(sum.methods).forEach((m) => aoa.push(['', m, '', posMoney(sum.methods[m])]));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 7 }, { wch: 11 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Sales sheet');
  XLSX.writeFile(wb, 'Sales_' + posSheetData.branch.replace(/\W+/g, '_') + '_' + posSheetData.date + '.xlsx');
}

// ── Cashiers ────────────────────────────────────────────────────────

async function loadPosCashiers() {
  const d = posCfg;
  const wrap = document.getElementById('posCashBranchWrap');
  const sel = document.getElementById('posCashBranch');
  wrap.hidden = d.branches.length < 2;
  if (!sel.options.length) { sel.innerHTML = d.branches.map((b) => '<option value="' + escapeAttr(b) + '">' + escapeHtml(b) + '</option>').join(''); sel.value = d.branch; }
  const list = document.getElementById('posCashList');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const res = await apiPost('posCashier', { requesterEmail: currentUser.email, op: 'list', branch: sel.value });
  if (!res.success) { list.innerHTML = '<p class="error-text">' + escapeHtml(res.error || 'Could not load cashiers.') + '</p>'; return; }
  list.innerHTML = res.cashiers.length ? res.cashiers.map((c) => '<div class="fin-line' + (c.active ? '' : ' pos-cancelled') + '"><span class="fin-line-main">' +
    '<span class="fin-line-desc">' + escapeHtml(c.name) + (c.active ? '' : ' <span class="status-tag as-gone">Inactive</span>') + '</span>' +
    '<span class="fin-line-meta">' + (c.email ? 'Staff · ' + escapeHtml(c.email) : 'Volunteer / no app account') + '</span></span>' +
    '<span class="fin-line-side"><button type="button" class="link-btn" data-cpin="' + escapeAttr(c.id) + '" data-cname="' + escapeAttr(c.name) + '" data-cactive="' + (c.active ? '1' : '0') + '">' + (c.active ? 'New PIN' : 'Bring back') + '</button>' +
    (c.active ? '<button type="button" class="link-btn asset-file-rm" data-coff="' + escapeAttr(c.id) + '" data-cname="' + escapeAttr(c.name) + '">Remove</button>' : '') + '</span></div>').join('')
    : '<p class="muted">No cashiers yet. Add the people who work the till below.</p>';
}

async function addPosCashier() {
  const err = document.getElementById('pcError');
  const name = document.getElementById('pcName').value.trim();
  const pin = document.getElementById('pcPin').value;
  err.textContent = '';
  if (!name) { err.textContent = 'Enter the cashier\'s name.'; return; }
  if (!/^\d{4}$/.test(pin)) { err.textContent = 'The PIN must be 4 digits.'; return; }
  if (pin !== document.getElementById('pcPin2').value) { err.textContent = 'The two PINs don\'t match.'; return; }
  const btn = document.getElementById('pcAdd');
  btn.disabled = true;
  const res = await apiPost('posCashier', { requesterEmail: currentUser.email, op: 'add', branch: document.getElementById('posCashBranch').value,
    name: name, email: document.getElementById('pcEmail').value.trim(), pin: pin });
  btn.disabled = false;
  if (!res.success) { err.textContent = res.error || 'Could not add the cashier.'; return; }
  ['pcName', 'pcEmail', 'pcPin', 'pcPin2'].forEach((id) => { document.getElementById(id).value = ''; });
  await loadPosCashiers();
  refreshPosConfigQuietly();
}

function openPosCashierPin(id, name, active) {
  openPosDialog({
    title: active ? 'New PIN for ' + name : 'Bring back ' + name, sub: 'They use it to sign in at the till.',
    body: '<div class="grid-2"><label>New PIN <input type="password" id="pdPin" inputmode="numeric" maxlength="4"></label><label>PIN again <input type="password" id="pdPin2" inputmode="numeric" maxlength="4"></label></div>',
    ok: 'Save',
    onOk: async () => {
      const pin = document.getElementById('pdPin').value;
      if (!/^\d{4}$/.test(pin)) return 'The PIN must be 4 digits.';
      if (pin !== document.getElementById('pdPin2').value) return 'The two PINs don\'t match.';
      const res = await apiPost('posCashier', active ? { requesterEmail: currentUser.email, op: 'pin', id: id, pin: pin }
        : { requesterEmail: currentUser.email, op: 'active', id: id, active: true, pin: pin });
      if (!res.success) return res.error || 'Could not save.';
      loadPosCashiers(); refreshPosConfigQuietly();
      return '';
    }
  });
}

function openPosCashierOff(id, name) {
  openPosDialog({
    title: 'Remove ' + name + '?', sub: 'Their PIN stops working. Their past sales keep their name.', body: '', ok: 'Remove',
    onOk: async () => {
      const res = await apiPost('posCashier', { requesterEmail: currentUser.email, op: 'active', id: id, active: false });
      if (!res.success) return res.error || 'Could not remove.';
      loadPosCashiers(); refreshPosConfigQuietly();
      return '';
    }
  });
}

async function refreshPosConfigQuietly() {
  const res = await apiGet('posConfig', { email: currentUser.email, branch: posBranchNow() });
  if (res.success) { posCfg = res; posWrite(posKey('cfg'), res); renderPosCashier(); }
}

// ── Settings ────────────────────────────────────────────────────────

function renderPosSettings() {
  const dev = posDevice();
  document.getElementById('psTill').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<option value="' + n + '">Till ' + n + '</option>').join('');
  document.getElementById('psTill').value = dev.till;
  document.getElementById('psMode').value = dev.mode;
  document.getElementById('psPaper').value = String(dev.paper);
  document.getElementById('psAutoPrint').checked = !!dev.autoPrint;
  const admin = posCfg.canManage;
  document.getElementById('psAdmin').hidden = !admin;
  if (!admin) return;
  document.getElementById('psHeader').value = posCfg.receipt.header || '';
  document.getElementById('psFooter').value = posCfg.receipt.footer || '';
  const cats = posCfg.categories;
  document.getElementById('psCatList').innerHTML = cats.map((c, i) => '<div class="pos-cat-row' + (c.active ? '' : ' is-hidden') + '">' +
    '<span class="pos-cat-order"><button type="button" class="link-btn" data-cmove="up" data-cid="' + escapeAttr(c.id) + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">▲</button>' +
    '<button type="button" class="link-btn" data-cmove="down" data-cid="' + escapeAttr(c.id) + '"' + (i === cats.length - 1 ? ' disabled' : '') + ' aria-label="Move down">▼</button></span>' +
    '<span class="pos-cat-label">' + escapeHtml(c.name) + (c.active ? '' : ' <span class="status-tag as-gone">Hidden</span>') + '</span>' +
    '<span class="muted">' + (c.defaultPrice !== null ? rand(c.defaultPrice) : 'no usual price') + '</span>' +
    '<button type="button" class="link-btn" data-cedit="' + escapeAttr(c.id) + '">Edit</button></div>').join('');
}

function savePosDevice(patch) {
  posWrite('pos_device', Object.assign(posDevice(), patch));
  applyPosMode();
  if (posCfg) document.getElementById('posTillChip').textContent = (posCfg.branch ? posCfg.branch + ' · ' : '') + 'Till ' + posDevice().till;
}

async function posCategoryCall(payload, errId) {
  const err = document.getElementById(errId || 'psCatError');
  err.textContent = '';
  const res = await apiPost('posCategory', Object.assign({ requesterEmail: currentUser.email }, payload));
  if (!res.success) { err.textContent = res.error || 'Could not save.'; return false; }
  await refreshPosConfigQuietly();
  renderPosSettings();
  return true;
}

function openPosCategoryEdit(id) {
  const c = posCfg.categories.filter((x) => x.id === id)[0];
  openPosDialog({
    title: 'Edit category', sub: c.name,
    body: '<label>Name <input type="text" id="pdCatName" maxlength="40" value="' + escapeAttr(c.name) + '"></label>' +
      '<label>Usual price (R, optional) <input type="number" id="pdCatPrice" min="0" step="0.01" value="' + (c.defaultPrice !== null ? c.defaultPrice : '') + '"></label>' +
      '<label class="fin-check"><input type="checkbox" id="pdCatActive"' + (c.active ? ' checked' : '') + '> Show on the till</label>',
    ok: 'Save',
    onOk: async () => {
      const ok = await posCategoryCall({ op: 'update', id: id, name: document.getElementById('pdCatName').value, defaultPrice: document.getElementById('pdCatPrice').value,
        active: document.getElementById('pdCatActive').checked }, 'posDialogError');
      return ok ? '' : (document.getElementById('posDialogError').textContent || 'Could not save.');
    }
  });
}

// ── Small dialog ────────────────────────────────────────────────────

function openPosDialog(spec) {
  posDialogOk = spec.onOk;
  document.getElementById('posDialogTitle').textContent = spec.title;
  document.getElementById('posDialogSub').textContent = spec.sub || '';
  document.getElementById('posDialogBody').innerHTML = spec.body || '';
  document.getElementById('posDialogError').textContent = '';
  document.getElementById('posDialogOk').textContent = spec.ok || 'OK';
  document.getElementById('posDialogOk').disabled = false;
  document.getElementById('posDialogCancel').textContent = 'Back';
  document.getElementById('posDialogBackdrop').hidden = false;
  const first = document.querySelector('#posDialogBody input');
  if (first) setTimeout(() => first.focus(), 30);
}
async function posDialogConfirm() {
  const btn = document.getElementById('posDialogOk');
  btn.disabled = true;
  const msg = await posDialogOk();
  btn.disabled = false;
  if (msg) { document.getElementById('posDialogError').textContent = msg; return; }
  document.getElementById('posDialogBackdrop').hidden = true;
}

// ── Wiring ──────────────────────────────────────────────────────────

(function wireTill() {
  const el = (id) => document.getElementById(id);
  document.querySelectorAll('#posTabs button').forEach((b) => b.addEventListener('click', () => showPosTab(b.dataset.pt)));
  el('posBranch').addEventListener('change', () => {
    if (posSale.lines.length) { el('posBranch').value = posBranchNow(); showPosError('Finish or clear the current sale before changing branch.'); return; }
    posCfg = null; loadTillPage(el('posBranch').value);
  });
  el('posCashierBtn').addEventListener('click', openPosPin);
  el('posPinPad').addEventListener('click', (e) => { const b = e.target.closest('[data-pin]'); if (b) pinKey(b.dataset.pin); });
  el('posPinMe').addEventListener('click', () => {
    try { localStorage.removeItem(posKey('cashier')); } catch (e) { /* ignore */ }
    el('posPinBackdrop').hidden = true; renderPosCashier();
  });
  el('posPinClose').addEventListener('click', () => { el('posPinBackdrop').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (el('posPinBackdrop').hidden) return;
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('⌫');
  });
  el('posCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) openPosLine(b.dataset.cat); });
  el('posCustomBtn').addEventListener('click', () => {
    const other = posCfg.categories.filter((c) => c.active && /^other$/i.test(c.name))[0];
    openPosLine(other ? other.id : '');
  });
  el('posLines').addEventListener('click', (e) => { const b = e.target.closest('[data-line]'); if (b) openPosLine(null, Number(b.dataset.line)); });
  el('posMethods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-method]');
    if (!b) return;
    posSale.method = b.dataset.method;
    if (posSale.method !== 'Cash') el('posCashIn').value = '';
    renderPosSale();
  });
  el('posQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cash]');
    if (!b) return;
    el('posCashIn').value = b.dataset.cash === 'exact' ? posSaleTotal() : b.dataset.cash;
    updatePosChange();
  });
  el('posCashIn').addEventListener('input', updatePosChange);
  el('posCashIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !el('posComplete').disabled) completePosSale(); });
  el('posComplete').addEventListener('click', completePosSale);
  el('posClearBtn').addEventListener('click', () => {
    const b = el('posClearBtn');
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to clear'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Clear'; }, 3000); return; }
    b.dataset.confirm = ''; b.textContent = 'Clear';
    posSale = { lines: [], method: 'Cash' }; el('posCashIn').value = ''; renderPosSale();
  });
  el('posNewSale').addEventListener('click', () => { posHideDone(); renderPosSale(); });
  el('posPrintBtn').addEventListener('click', () => { if (posLastDone) printPosReceipt(posLastDone, false); });
  el('posOpenBtn').addEventListener('click', openPosTill);
  el('posFloatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') openPosTill(); });
  el('posStaleClose').addEventListener('click', openPosCloseTill);
  el('posCloseTillBtn').addEventListener('click', openPosCloseTill);
  el('posFindBtn').addEventListener('click', () => openPosFind(''));
  el('posFindGo').addEventListener('click', runPosFind);
  el('posFindIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') runPosFind(); });
  el('posReceiptClose').addEventListener('click', () => { el('posReceiptBackdrop').hidden = true; });
  el('posReceiptBody').addEventListener('click', (e) => {
    const p = e.target.closest('[data-rcpt-print]');
    if (p) { const x = posFound[Number(p.dataset.rcptPrint)]; printPosReceipt(posServerToReceipt(x), true); return; }
    const r = e.target.closest('[data-rcpt-refund]');
    if (r) openPosRefund(Number(r.dataset.rcptRefund));
  });
  el('posRecent').addEventListener('click', (e) => {
    const rf = e.target.closest('[data-refund]');
    if (rf) { openPosFind(rf.dataset.refund); return; }
    const r = e.target.closest('[data-reprint]');
    if (r) { const s = posRecent().filter((x) => x.uid === r.dataset.reprint)[0]; if (s) printPosReceipt(s, true); return; }
    const v = e.target.closest('[data-void]');
    if (v) openPosVoid(v.dataset.void);
  });
  // line editor
  el('plMinus').addEventListener('click', () => { el('plQty').value = Math.max(1, (Number(el('plQty').value) || 1) - 1); updatePosLineTotal(); });
  el('plPlus').addEventListener('click', () => { el('plQty').value = Math.min(999, (Number(el('plQty').value) || 0) + 1); updatePosLineTotal(); });
  ['plQty', 'plPrice'].forEach((id) => el(id).addEventListener('input', updatePosLineTotal));
  ['plQty', 'plPrice', 'plDesc'].forEach((id) => el(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePosLine(); } }));
  el('plSave').addEventListener('click', savePosLine);
  el('plRemove').addEventListener('click', () => { posSale.lines.splice(posEditing, 1); el('posLineBackdrop').hidden = true; renderPosSale(); });
  el('posLineClose').addEventListener('click', () => { el('posLineBackdrop').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('posLineBackdrop').hidden) el('posLineBackdrop').hidden = true; });
  // sheet
  el('posSheetBranch').addEventListener('change', loadPosSheet);
  el('posSheetDate').addEventListener('change', loadPosSheet);
  el('posSheetPrint').addEventListener('click', printPosSheet);
  el('posSheetExcel').addEventListener('click', excelPosSheet);
  // cashiers
  el('posCashBranch').addEventListener('change', loadPosCashiers);
  el('pcAdd').addEventListener('click', addPosCashier);
  el('posCashList').addEventListener('click', (e) => {
    const p = e.target.closest('[data-cpin]');
    if (p) { openPosCashierPin(p.dataset.cpin, p.dataset.cname, p.dataset.cactive === '1'); return; }
    const o = e.target.closest('[data-coff]');
    if (o) openPosCashierOff(o.dataset.coff, o.dataset.cname);
  });
  // settings
  el('psTill').addEventListener('change', () => savePosDevice({ till: Number(el('psTill').value) }));
  el('psMode').addEventListener('change', () => savePosDevice({ mode: el('psMode').value }));
  el('psPaper').addEventListener('change', () => savePosDevice({ paper: Number(el('psPaper').value) }));
  el('psAutoPrint').addEventListener('change', () => savePosDevice({ autoPrint: el('psAutoPrint').checked }));
  el('psCatAdd').addEventListener('click', async () => {
    if (await posCategoryCall({ op: 'add', name: el('psCatName').value, defaultPrice: el('psCatPrice').value })) { el('psCatName').value = ''; el('psCatPrice').value = ''; }
  });
  el('psCatList').addEventListener('click', (e) => {
    const m = e.target.closest('[data-cmove]');
    if (m) { posCategoryCall({ op: 'move', id: m.dataset.cid, dir: m.dataset.cmove }); return; }
    const ed = e.target.closest('[data-cedit]');
    if (ed) openPosCategoryEdit(ed.dataset.cedit);
  });
  el('psRcptSave').addEventListener('click', async () => {
    const err = el('psRcptError');
    err.textContent = '';
    const res = await apiPost('posSettings', { requesterEmail: currentUser.email, header: el('psHeader').value, footer: el('psFooter').value });
    if (!res.success) { err.textContent = res.error || 'Could not save.'; return; }
    await refreshPosConfigQuietly();
    err.textContent = 'Saved.';
  });
  // dialog
  el('posDialogOk').addEventListener('click', posDialogConfirm);
  el('posDialogCancel').addEventListener('click', () => { el('posDialogBackdrop').hidden = true; });
  el('posDialogClose').addEventListener('click', () => { el('posDialogBackdrop').hidden = true; });
  window.addEventListener('online', () => { if (posCfg) posSyncNow(); });
  ['posLineBackdrop', 'posPinBackdrop', 'posDialogBackdrop', 'posReceiptBackdrop'].forEach((id) => guardModalBackdrop(id));
  el('mDate').addEventListener('change', loadTillCashup);
  el('mBranch').addEventListener('change', loadTillCashup);
})();

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// ─────────────────────────────────────────────────────────────────────
init();
