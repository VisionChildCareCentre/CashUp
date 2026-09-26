// ─────────────────────────────────────────────────────────────────────
// CONFIG — this is v2's OWN backend (new Sheet + new Apps Script
// deployment), separate from the live app, so it does not affect current
// users. Paste the new Web App /exec URL here after deploying it —
// see the Apps Script project bound to the new Google Sheet.
// ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwL0yLduCoItYz-g5XF8I0NZUmIsSfio5O2x3ivumSS4KXFpOW0QFBlH8-tpWiXHFNq/exec
';

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

  if (tab === 'approvals') loadAdminView(adminEmail);
  else if (tab === 'submissions') loadAdminSubmissions(adminEmail);
  else if (tab === 'dashboard') loadAdminDashboard(adminEmail);
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

async function loadAdminDashboard(adminEmail) {
  const result = await apiGet('dashboardTotals', { email: adminEmail });
  if (!result.success) {
    document.getElementById('admin-tab-dashboard').innerHTML = '<p class="error-text">' + result.error + '</p>';
    return;
  }
  document.getElementById('dashWeekCount').textContent = result.week.count;
  document.getElementById('dashWeekNett').textContent = rand(result.week.totalNettSales);
  document.getElementById('dashWeekCards').textContent = rand(result.week.totalCardsAndCash);
  document.getElementById('dashWeekDonations').textContent = rand(result.week.totalDonations);
  document.getElementById('dashWeekShortOver').textContent = rand(result.week.totalShortOver);

  document.getElementById('dashMonthCount').textContent = result.month.count;
  document.getElementById('dashMonthNett').textContent = rand(result.month.totalNettSales);
  document.getElementById('dashMonthCards').textContent = rand(result.month.totalCardsAndCash);
  document.getElementById('dashMonthDonations').textContent = rand(result.month.totalDonations);
  document.getElementById('dashMonthShortOver').textContent = rand(result.month.totalShortOver);

  const tbody = document.getElementById('dashByBranchBody');
  tbody.innerHTML = '';
  result.byBranch.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + escapeHtml(b.branch) + '</td><td>' + b.count + '</td><td>' + rand(b.totalNettSales) + '</td><td>' + rand(b.totalDonations) + '</td>';
    tbody.appendChild(tr);
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
