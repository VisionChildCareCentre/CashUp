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
  'backoffice', 'deliveries', 'hoexp', 'developer', 'loading'];
const NAVLESS_VIEWS = ['auth', 'devlogin', 'pending', 'rejected', 'inactive', 'loading'];
function showView(name) {
  views.forEach((v) => {
    document.getElementById('view-' + v).hidden = (v !== name);
  });
  const nav = document.getElementById('appNav');
  nav.hidden = NAVLESS_VIEWS.indexOf(name) !== -1 || nav.children.length < 2;
}

let currentUser = null; // { email, fullName, role, branch }

document.getElementById('switchUserBtn').addEventListener('click', () => {
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
    openPage(ROLE_HOME[result.role]);
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
  Developer:  ['cashup', 'shopexp', 'approvals', 'submissions', 'dashboard', 'deliveries', 'hoexp', 'developer']
};
const ROLE_HOME = { Manager: 'cashup', BackOffice: 'backoffice', Admin: 'approvals', Developer: 'approvals' };
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
        '<select class="role-select"><option value="Manager">Store Manager</option><option value="BackOffice">Back Office</option><option value="Admin">Admin</option></select>' +
        '<select class="branch-select">' + branchOptions + '</select>' +
        '<button class="btn-approve">Approve</button>' +
        '<button class="btn-reject">Reject</button>' +
      '</div>';

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
  const roleChoices = isDevTarget ? ['Developer'] : ['Manager', 'BackOffice', 'Admin'];
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
