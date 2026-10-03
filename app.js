// ─────────────────────────────────────────────────────────────────────
// CONFIG — this is v2's OWN backend (new Sheet + new Apps Script
// deployment), separate from the live app, so it does not affect current
// users. Paste the new Web App /exec URL here after deploying it —
// see the Apps Script project bound to the new Google Sheet.
// ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwL0yLduCoItYz-g5XF8I0NZUmIsSfio5O2x3ivumSS4KXFpOW0QFBlH8-tpWiXHFNq/exec';

const STORAGE_KEY = 'visionchildandyouthcarecentre@gmail.com';

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
  return fetchWithRetry(() => fetch(url.toString()));
}

async function apiPost(action, data) {
  const body = JSON.stringify(Object.assign({ action: action }, data));
  return fetchWithRetry(() => fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body
  }));
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

const views = ['auth', 'pending', 'rejected', 'manager', 'submitted', 'admin', 'backoffice', 'loading'];
function showView(name) {
  views.forEach((v) => {
    document.getElementById('view-' + v).hidden = (v !== name);
  });
}

let currentUser = null; // { email, fullName, role, branch }

document.getElementById('switchUserBtn').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  currentUser = null;
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

  localStorage.setItem(STORAGE_KEY, email);
  currentUser = result;
  document.getElementById('whoami').textContent = result.fullName + ' (' + (result.role || 'pending') + ')';
  document.getElementById('switchUserBtn').hidden = false;

  if (result.status === 'Pending') {
    document.getElementById('pendingName').textContent = result.fullName;
    showView('pending');
  } else if (result.status === 'Rejected') {
    showView('rejected');
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
  document.getElementById('mBranch').value = user.branch;
  if (!document.getElementById('mCasher').value) {
    document.getElementById('mCasher').value = user.fullName;
  }
  if (!document.getElementById('mDate').value) {
    document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  }
  document.getElementById('managerName').value = document.getElementById('managerName').value || '';
  recalcAll();
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
    (result.pdfWarning ? ' — note: ' + result.pdfWarning : '');
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
  showView('manager');
});

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
  document.body.classList.toggle('wide-admin', tab === 'dashboard');

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

async function loadAdminSubmissions(adminEmail) {
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

async function loadAdminView(adminEmail) {
  const result = await apiGet('pendingUsers', { email: adminEmail });
  const listEl = document.getElementById('pendingList');
  const noneEl = document.getElementById('noPending');
  listEl.innerHTML = '';

  if (!result.success) {
    listEl.innerHTML = '<p class="error-text">' + result.error + '</p>';
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
      '<option value="' + b + '"' + (b === p.requestedBranch ? ' selected' : '') + '>' + b + '</option>'
    ).join('');
    div.innerHTML =
      '<div class="name">' + escapeHtml(p.fullName) + '</div>' +
      '<div class="muted">' + escapeHtml(p.contact) + ' · ' + escapeHtml(p.email) + '</div>' +
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
      if (res.success) { div.remove(); } else { alert(res.error); div.querySelector('.btn-approve').disabled = false; }
    });
    div.querySelector('.btn-reject').addEventListener('click', async () => {
      if (!confirm('Reject ' + p.fullName + '\'s registration?')) return;
      div.querySelector('.btn-reject').disabled = true;
      const res = await apiPost('rejectUser', { requesterEmail: adminEmail, targetEmail: p.email });
      if (res.success) { div.remove(); } else { alert(res.error); div.querySelector('.btn-reject').disabled = false; }
    });

    listEl.appendChild(div);
  });
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

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// ─────────────────────────────────────────────────────────────────────
init();
