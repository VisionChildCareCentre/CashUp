// ─────────────────────────────────────────────────────────────────────
// CONFIG — this is v2's OWN backend (new Sheet + new Apps Script
// deployment), separate from the live app, so it does not affect current
// users. Paste the new Web App /exec URL here after deploying it —
// see the Apps Script project bound to the new Google Sheet.
// ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwL0yLduCoItYz-g5XF8I0NZUmIsSfio5O2x3ivumSS4KXFpOW0QFBlH8-tpWiXHFNq/exec';

const STORAGE_KEY = 'visionchildandyouthcarecentre@gmail.com';
const DEV_TOKEN_KEY = 'cashup_dev_token'; // developer sign-in session (6 hours from last use)

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
  const token = getDevToken();
  if (token) url.searchParams.set('token', token);
  return checkDevSession(await fetchWithRetry(() => fetch(url.toString())));
}

async function apiPost(action, data) {
  const payload = Object.assign({ action: action }, data);
  const token = getDevToken();
  if (token) payload.token = token;
  const body = JSON.stringify(payload);
  return checkDevSession(await fetchWithRetry(() => fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body
  })));
}

// A developer's sign-in lasts 6 hours from last use. If it runs out mid-way,
// the server answers "Not authorized" — send them back to the password screen.
function checkDevSession(result) {
  if (result && result.success === false && currentUser && currentUser.role === 'Developer' &&
      /Not authorized/.test(result.error || '')) {
    setDevToken('');
    setTimeout(() => showDevLogin(currentUser.email, 'Your developer sign-in has expired. Please sign in again.'), 0);
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

const views = ['auth', 'devlogin', 'pending', 'rejected', 'inactive', 'manager', 'shopexp', 'submitted', 'admin',
  'backoffice', 'deliveries', 'hoexp', 'developer', 'nopages', 'loading'];
const NAVLESS_VIEWS = ['auth', 'devlogin', 'pending', 'rejected', 'inactive', 'nopages', 'loading'];
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
  if (getDevToken()) { apiPost('devLogout', {}); setDevToken(''); }
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
  if (!result.success) {
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

  localStorage.setItem(STORAGE_KEY, email);
  currentUser = result;
  currentUser.features = result.features || {};
  document.getElementById('whoami').textContent = result.fullName + ' (' + (ROLE_LABELS[result.role] || result.role || 'pending') + ')';
  document.getElementById('switchUserBtn').hidden = false;

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
  hoexp:       { label: 'Head Office Expenses', feature: 'hoExpenses' },
  developer:   { label: 'Developer' }
};
const ROLE_PAGES = {
  Manager:    ['cashup', 'shopexp', 'deliveries'],
  BackOffice: ['backoffice', 'deliveries'],
  Admin:      ['approvals', 'submissions', 'dashboard', 'deliveries', 'hoexp'],
  Developer:  ['cashup', 'shopexp', 'approvals', 'submissions', 'dashboard', 'deliveries', 'hoexp', 'developer'],
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
  if (page !== 'approvals' && page !== 'dashboard') document.body.classList.remove('wide-admin');

  switch (page) {
    case 'cashup':
      setupManagerView(currentUser);
      showView('manager');
      break;
    case 'shopexp':
      showView('shopexp');
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
      break;
    case 'developer':
      showView('developer');
      loadDeveloperTab();
      break;
  }
  window.scrollTo(0, 0);
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
  const res = await apiPost('devLogin', { email: devLoginEmailValue, password: password });
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
    '<label>Type <select class="exp-type">' + EXPENSE_TYPES.map((t) => '<option>' + escapeHtml(t) + '</option>').join('') + '</select></label>' +
    '<label>Receipt photo <input type="file" class="exp-file" accept="image/*" capture="environment"></label>' +
    '<div class="exp-preview-wrap" hidden><img class="exp-preview" alt="Receipt preview">' +
      '<button type="button" class="link-btn exp-photo-remove">Remove photo</button></div>' +
    '<p class="error-text exp-file-error"></p>';

  div.querySelector('.exp-amount').addEventListener('input', recalcShopExpenses);
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
    lines.push({ date: el.querySelector('.exp-date').value, description, amount, type: el.querySelector('.exp-type').value, receiptImage });
  }
  return { lines };
}

function clearShopExpenses() {
  document.getElementById('expenseLines').innerHTML = '';
  expenseReceipts.clear();
  renumberExpenseLines();
  recalcShopExpenses();
}

document.getElementById('addExpenseBtn').addEventListener('click', addExpenseLine);

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
          (sub.pdfUrl ? '<a href="' + escapeAttr(sub.pdfUrl) + '" target="_blank" rel="noopener">PDF</a>' : '') + '</div>' +
      '</div>' +
      '<ul class="expense-sub-lines">' + sub.lines.map((l) =>
        '<li><span class="exp-l-desc">' + escapeHtml(l.description) + '</span>' +
        '<span class="exp-l-type">' + escapeHtml(l.type) + '</span>' +
        '<span class="exp-l-amt">' + rand(l.amount) + '</span>' +
        (l.receiptUrl ? '<a href="' + escapeAttr(l.receiptUrl) + '" target="_blank" rel="noopener">Receipt</a>' : '<span class="muted">No receipt</span>') +
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
        (r.pdfUrl ? '<div style="margin-top:6px;"><a href="' + r.pdfUrl + '" target="_blank" style="font-size:12px;font-weight:700;">View PDF</a></div>' : '') +
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
      '<span>' + (s.pdfUrl ? '<a href="' + s.pdfUrl + '" target="_blank">PDF</a>' : '') + '</span>';
    listEl.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────────────────
// ADMIN VIEW — Approvals tab: "Pending requests" + "All users"
// ─────────────────────────────────────────────────────────────────────

const ROLE_LABELS = { Manager: 'Store Manager', BackOffice: 'Back Office', Admin: 'Admin', Developer: 'Developer' };
let adminUsers = [];        // every row of the Users sheet (from 'allUsers')
let adminUserBranches = []; // branch list for the edit dialog
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

  const [pendingRes, usersRes] = await Promise.all([
    apiGet('pendingUsers', { email: adminEmail }),
    apiGet('allUsers', { email: adminEmail })
  ]);
  if (seq !== adminLoadSeq) return;

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
  renderUsersTable();
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
  document.getElementById('userEditBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'userEditBackdrop') closeUserEdit();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('userEditBackdrop').hidden) closeUserEdit();
  });
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
      '<td class="nowrap">' + escapeHtml(formatContact(u.contact)) + '</td>' +
      '<td>' + escapeHtml(u.email) + '</td>' +
      '<td>' + escapeHtml(u.requestedBranch || '—') + '</td>' +
      '<td>' + statusTag(u.status) + '</td>' +
      '<td class="nowrap">' + escapeHtml(ROLE_LABELS[u.role] || u.role || '—') + '</td>' +
      '<td>' + escapeHtml(u.branch || '—') + '</td>' +
      '<td>' + escapeHtml(u.approvedBy || '—') + '</td>' +
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
  document.getElementById('userEditSubtitle').textContent = user.email;

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
  if (user.approvedBy) meta.push('Approved by ' + user.approvedBy + (user.approvedDate ? ' on ' + formatShortDateTime(user.approvedDate) : ''));
  if (user.lastEditedBy) meta.push('Last edited by ' + user.lastEditedBy + (user.lastEditedDate ? ' on ' + formatShortDateTime(user.lastEditedDate) : ''));
  document.getElementById('userEditMeta').textContent = meta.join(' · ');

  document.getElementById('userEditError').textContent = '';
  const saveBtn = document.getElementById('userEditSave');
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save changes';

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
}

function closeUserEdit() {
  document.getElementById('userEditBackdrop').hidden = true;
  editingUser = null;
}

async function saveUserEdit() {
  if (!editingUser) return;
  const saveBtn = document.getElementById('userEditSave');
  const errEl = document.getElementById('userEditError');
  errEl.textContent = '';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const res = await apiPost('updateUser', {
    requesterEmail: usersAdminEmail,
    targetEmail: editingUser.email,
    status: document.getElementById('userEditStatus').value,
    role: document.getElementById('userEditRole').value,
    branch: document.getElementById('userEditBranch').value
  });

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
      '<span>' + (s.pdfUrl ? '<a href="' + s.pdfUrl + '" target="_blank">PDF</a>' : '') + '</span>';
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
  ['jobNewBackdrop', 'jobBackdrop'].forEach((id) => document.getElementById(id).addEventListener('click', (e) => {
    if (e.target.id === id) (id === 'jobBackdrop' ? closeJob : closeNewJob)();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('jobBackdrop').hidden) closeJob();
    else if (!document.getElementById('jobNewBackdrop').hidden) closeNewJob();
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
    BackOffice: 'All deliveries, collections and transfers across branches (view only).'
  }[res.role] || 'All deliveries, collections and transfers across branches. Open a job to approve it, schedule a driver, resolve a transfer discrepancy, put it on hold or cancel it.';
  document.getElementById('jobsIntro').textContent = intro;
  document.getElementById('newJobBtn').hidden = !res.canCreate;

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
      row('Proof', j.proofUrl ? '<a href="' + escapeAttr(j.proofUrl) + '" target="_blank" rel="noopener">View signed delivery note</a>' : '', true) +
      row('Driver\'s note', j.completionNotes) +
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
    const willBeOn = pro && ticked;
    return '<label class="feature-row' + (pro ? '' : ' is-disabled') + '">' +
      '<input type="checkbox" data-key="' + escapeAttr(f.key) + '"' + (ticked ? ' checked' : '') + (pro ? '' : ' disabled') + '>' +
      '<span class="feature-body">' +
        '<span class="feature-name">' + escapeHtml(f.name) +
          ' <span class="feature-tag tag-bundle">' + escapeHtml(f.bundle) + '</span>' +
          ' <span class="feature-tag ' + (f.stage === 'Live' ? 'tag-live' : 'tag-placeholder') + '">' + escapeHtml(f.stage) + '</span>' +
        '</span>' +
        '<span class="feature-desc">' + escapeHtml(f.description) + '</span>' +
      '</span>' +
      '<span class="feature-state ' + (willBeOn ? 'on' : 'off') + '">' + (willBeOn ? 'On' : 'Off') + '</span>' +
    '</label>';
  }).join('');

  const saveBtn = document.getElementById('devSaveSettings');
  const changed = devDraftChanged();
  saveBtn.disabled = !changed;
  saveBtn.textContent = changed ? 'Save bundle settings' : 'Saved';
}

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
      (d.hasPassword ? '' : ' <span class="status-tag tag-pending">No password</span>') + '</div></div>'
  ).join('') + '<p class="muted" style="font-size:13px;">To switch a developer off, use Approvals → All users → Edit.</p>';
}

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

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// ─────────────────────────────────────────────────────────────────────
init();
