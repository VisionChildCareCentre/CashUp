/**
 * VISION CHILD & YOUTH CARE CENTRE — Charity Shop Daily Cash-Up
 * Apps Script backend. Deploy as Web App (Execute as: Me, Access: Anyone).
 *
 * ─── ONE-TIME SETUP ───────────────────────────────────────────────────────
 * 1. Fill in the CONFIG block below.
 * 2. Run setupSheets() once (from Setup.gs) to create tabs + headers.
 * 3. Manually add ONE row to the "Users" sheet for yourself:
 *    Status=Approved, Role=Admin, Branch=Head Office
 *    (This bootstraps the first admin — everyone else gets approved
 *    through the app itself from then on.)
 * 4. Deploy > New deployment > Web app > Execute as Me > Who has access: Anyone.
 * 5. Copy the /exec URL into APPS_SCRIPT_URL in frontend/app.js.
 * ────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  // TODO: replace with the NEW Google Sheet's ID (from its URL, between /d/ and /edit) —
  // this is a fresh sheet for v2, separate from the live one, so live users/data are untouched.
  SHEET_ID: '1Zk_exGOmLgrZdD-189hvNNmXxvaBiAmhb-Aylxc2zKY',
  // TODO: replace with the new GitHub Pages repo's URL once it's live
  APP_URL: 'https://visionchildcarecentre.github.io/CashUp/',
  // Logo can keep pointing at the old repo (it's just a public raw-file URL, works from anywhere),
  // or update this to the new repo's assets/logo.jpg once it's uploaded there.
  LOGO_URL: 'https://raw.githubusercontent.com/VisionChildCareCentre/CashUp/main/Vision_Child_Care.jpg',
  ORG_NAME: 'Vision Child and Youth Care Centre',
  TIMEZONE: 'Africa/Johannesburg',
  // Every cash-up email (and its PDFs) always goes to this inbox as well as
  // to Back Office users. Developers have access to it; the client doesn't.
  CASHUP_EMAIL_ALWAYS: 'visionchildandyouthcarecentre@gmail.com',
  // Start of downloaded file names, e.g. Vision_Ledger_2026-10-01_to_2026-10-31.csv
  EXPORT_NAME: 'Vision'
};

const SHEETS = {
  USERS: 'Users',
  BRANCHES: 'Branches',
  CASHUPS: 'CashUps',
  DONATIONS: 'Donations',
  SHOP_EXPENSES: 'Shop Expenses', // created automatically on first use
  SETTINGS: 'Settings',           // created automatically on first use
  SETTINGS_LOG: 'SettingsLog',    // created automatically on first use
  DEV_AUTH: 'DevAuth',            // developer password hashes — never shown in the app
  JOBS: 'Jobs',                   // deliveries & collections (created automatically)
  JOB_HISTORY: 'JobHistory',      // audit trail of every job status change
  JOB_ITEMS: 'JobItems',          // inter-branch transfer item lines
  FINANCE: 'Finance',             // Head Office expenses & income
  FIN_RECURRING: 'FinanceRecurring', // repeat-monthly templates
  FIN_CATEGORIES: 'FinanceCategories', // shared expense/income subcategories
  NOTIFICATIONS: 'Notifications'  // in-app notifications (the bell)
};

// Set per request from the "token" the app sends. Only developers have one
// (issued by devLogin); everyone else's requests carry none.
let REQUEST_TOKEN = '';

// ─────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    REQUEST_TOKEN = String(e.parameter.token || '');
    const action = e.parameter.action;
    switch (action) {
      case 'checkUser':
        return jsonOut(checkUser(e.parameter.email));
      case 'branches':
        return jsonOut({ success: true, branches: getBranches() });
      case 'pendingUsers':
        return jsonOut(getPendingUsers(e.parameter.email));
      case 'allUsers':
        return jsonOut(getAllUsers(e.parameter.email));
      case 'devSettings':
        return jsonOut(getDevSettings(e.parameter.email));
      case 'shopExpenses':
        return jsonOut(getShopExpenseSubmissions(e.parameter.email, e.parameter.branch));
      case 'jobs':
        return jsonOut(getJobs(e.parameter.email));
      case 'job':
        return jsonOut(getJob(e.parameter.email, e.parameter.ref));
      case 'deliveriesDashboard':
        return jsonOut(getDeliveriesDashboard(e.parameter.email, e.parameter));
      case 'notifications':
        return jsonOut(getNotifications(e.parameter.email));
      case 'financeSetup':
        return jsonOut(getFinanceSetup(e.parameter.email));
      case 'financeSummary':
        return jsonOut(getFinanceSummary(e.parameter.email, e.parameter));
      case 'financeEntries':
        return jsonOut(getFinanceEntries(e.parameter.email, e.parameter));
      case 'financeDue':
        return jsonOut(getFinanceDue(e.parameter.email));
      case 'file':
        return jsonOut(getFile(e.parameter.email, e.parameter.t, e.parameter.r, e.parameter.l));
      case 'exportCatalog':
        return jsonOut(getExportCatalog(e.parameter.email));
      case 'export':
        return jsonOut(getExport(e.parameter.email, e.parameter));
      case 'recentSubmissions':
        return jsonOut(getRecentSubmissions(e.parameter.branch, e.parameter.email));
      case 'dashboardTotals':
        return jsonOut(getDashboardTotals(e.parameter.email));
      case 'dashboardV2':
        return jsonOut(getDashboardV2(e.parameter.email, {
          period: e.parameter.period,
          from: e.parameter.from,
          to: e.parameter.to,
          branch: e.parameter.branch
        }));
      case 'shortOverDetail':
        return jsonOut(getShortOverDetail(e.parameter.email, {
          period: e.parameter.period,
          from: e.parameter.from,
          to: e.parameter.to,
          branch: e.parameter.branch
        }));
      default:
        return jsonOut({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: 'Invalid request body' });
  }
  REQUEST_TOKEN = String(body.token || '');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut({ success: false, error: 'Server is busy, please try again in a few seconds.' });
  }

  try {
    switch (body.action) {
      case 'register':
        return jsonOut(registerUser(body));
      case 'approveUser':
        return jsonOut(approveUser(body));
      case 'rejectUser':
        return jsonOut(rejectUser(body));
      case 'updateUser':
        return jsonOut(updateUser(body));
      case 'devLogin':
        return jsonOut(devLogin(body));
      case 'devLogout':
        return jsonOut(devLogout());
      case 'saveDevSettings':
        return jsonOut(saveDevSettings(body));
      case 'addDeveloper':
        return jsonOut(addDeveloper(body));
      case 'changeMyPassword':
        return jsonOut(changeMyPassword(body));
      case 'createJob':
        return jsonOut(createJob(body));
      case 'jobAction':
        return jsonOut(jobAction(body));
      case 'setCollectionValue':
        return jsonOut(setCollectionValue(body));
      case 'sendWeeklyEmailPreview':
        return jsonOut(sendWeeklyEmailPreview(body));
      case 'markNotificationsRead':
        return jsonOut(markNotificationsRead(body));
      case 'financeSave':
        return jsonOut(saveFinanceEntry(body));
      case 'financeDelete':
        return jsonOut(deleteFinanceEntry(body));
      case 'financeCategory':
        return jsonOut(financeCategoryAction(body));
      case 'financeRecurring':
        return jsonOut(financeRecurringAction(body));
      case 'submitCashUp':
        return jsonOut(submitCashUp(body));
      default:
        return jsonOut({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function sheet(name) {
  const s = ss().getSheetByName(name);
  if (!s) throw new Error('Missing sheet tab: ' + name + '. Run setupSheets() first.');
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
// USERS / AUTH (simple email-based, no password — matches your other apps)
// ─────────────────────────────────────────────────────────────────────────

function findUserRow(email) {
  const s = sheet(SHEETS.USERS);
  const data = s.getDataRange().getValues();
  const emailCol = 3; // column D (0-indexed)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailCol]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function checkUser(email) {
  if (!email) return { success: false, error: 'No email supplied' };
  const found = findUserRow(email);
  if (!found) return { success: true, found: false };
  const row = found.row;

  // A developer only gets their details once signed in with their password.
  if (row[6] === 'Developer' && row[5] === 'Approved' && !isValidDevSession(row[3])) {
    return { success: true, found: true, needsPassword: true, email: row[3], role: 'Developer', status: 'Approved', fullName: '' };
  }

  return {
    success: true,
    found: true,
    fullName: row[1],
    contact: row[2],
    email: row[3],
    requestedBranch: row[4],
    status: row[5],
    role: row[6],
    branch: row[7],
    features: getEnabledFeatures()
  };
}

function registerUser(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !body.fullName || !body.contact) {
    return { success: false, error: 'Full name, contact number and email are required.' };
  }
  const existing = findUserRow(email);
  if (existing) {
    return { success: false, error: 'This email is already registered.' };
  }
  const s = sheet(SHEETS.USERS);
  s.appendRow([
    new Date(),
    body.fullName,
    body.contact,
    email,
    body.requestedBranch || '',
    'Pending',
    '',       // Role - set on approval
    '',       // Branch - set on approval
    '',       // ApprovedBy
    ''        // ApprovedDate
  ]);

  // Notify all current admins
  const admins = getAdminEmails();
  if (admins.length > 0) {
    MailApp.sendEmail({
      to: admins.join(','),
      subject: 'New registration awaiting approval — ' + CONFIG.ORG_NAME,
      body:
        'A new user has registered for the Cash-Up app and is waiting for approval:\n\n' +
        'Name: ' + body.fullName + '\n' +
        'Contact: ' + body.contact + '\n' +
        'Email: ' + email + '\n' +
        'Requested branch: ' + (body.requestedBranch || '(not specified)') + '\n\n' +
        'Log in to the app to review and approve: ' + CONFIG.APP_URL
    });
  }

  return { success: true };
}

function getAdminEmails() {
  const s = sheet(SHEETS.USERS);
  const data = s.getDataRange().getValues();
  const emails = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === 'Approved' && data[i][6] === 'Admin') {
      emails.push(data[i][3]);
    }
  }
  return emails;
}

// Like findUserRow, but a Developer only counts if this request carries a
// valid developer sign-in. Use this for "who is asking", never for targets.
function authUser(email) {
  const found = findUserRow(email);
  if (!found) return null;
  if (found.row[6] === 'Developer' && !isValidDevSession(found.row[3])) return null;
  return found;
}

function requireAdmin(email) {
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved' || (found.row[6] !== 'Admin' && found.row[6] !== 'Developer')) {
    throw new Error('Not authorized — admin access required.');
  }
  return found;
}

function requireDeveloper(email) {
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved' || found.row[6] !== 'Developer') {
    throw new Error('Not authorized — developer access required.');
  }
  return found;
}

function getPendingUsers(requesterEmail) {
  requireAdmin(requesterEmail);
  const s = sheet(SHEETS.USERS);
  const data = s.getDataRange().getValues();
  const pending = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === 'Pending') {
      pending.push({
        email: data[i][3],
        fullName: data[i][1],
        contact: data[i][2],
        requestedBranch: data[i][4],
        timestamp: data[i][0]
      });
    }
  }
  return { success: true, pending: pending, branches: getBranches() };
}

function approveUser(body) {
  requireAdmin(body.requesterEmail);
  if (!body.role || !body.branch) {
    return { success: false, error: 'Role and branch are required to approve a user.' };
  }
  if (['Manager', 'BackOffice', 'Admin', 'Driver'].indexOf(body.role) === -1) {
    return { success: false, error: 'Choose a valid role.' };
  }
  // Drivers are shared across all branches.
  if (body.role === 'Driver') body.branch = DRIVER_BRANCH;
  const found = findUserRow(body.targetEmail);
  if (!found || found.row[6] === 'Developer') return { success: false, error: 'User not found.' };

  const s = sheet(SHEETS.USERS);
  s.getRange(found.rowIndex, 6).setValue('Approved');       // Status
  s.getRange(found.rowIndex, 7).setValue(body.role);         // Role
  s.getRange(found.rowIndex, 8).setValue(body.branch);       // Branch
  s.getRange(found.rowIndex, 9).setValue(body.requesterEmail); // ApprovedBy
  s.getRange(found.rowIndex, 10).setValue(new Date());       // ApprovedDate

  MailApp.sendEmail({
    to: body.targetEmail,
    subject: 'You\'re approved — ' + CONFIG.ORG_NAME + ' Cash-Up app',
    body:
      'Good news — your access has been approved.\n\n' +
      'Role: ' + body.role + '\n' +
      'Branch: ' + body.branch + '\n\n' +
      'Open the app here: ' + CONFIG.APP_URL
  });

  return { success: true };
}

function rejectUser(body) {
  requireAdmin(body.requesterEmail);
  const found = findUserRow(body.targetEmail);
  if (!found || found.row[6] === 'Developer') return { success: false, error: 'User not found.' };
  const s = sheet(SHEETS.USERS);
  s.getRange(found.rowIndex, 6).setValue('Rejected');
  MailApp.sendEmail({
    to: body.targetEmail,
    subject: 'Registration update — ' + CONFIG.ORG_NAME + ' Cash-Up app',
    body: 'Your registration for the Cash-Up app was not approved. Please contact your manager for more information.'
  });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT (Admin → Approvals tab → "All users")
//
// Users sheet columns:
//   A Timestamp | B FullName | C Contact | D Email | E RequestedBranch |
//   F Status | G Role | H Branch | I ApprovedBy | J ApprovedDate |
//   K LastEditedBy | L LastEditedDate   (K/L are added automatically the
//                                        first time an admin edits a user)
//
// Status values: Pending, Approved, Rejected, Inactive.
// Role values: Manager, BackOffice, Admin, Driver, Developer. Developer rows are only
// visible to (and editable by) other developers — see DEVELOPERS below.
// "Inactive" = access switched off (e.g. staff member has left). Every
// existing check in this file only lets Status = Approved through, so an
// Inactive user can't log in, submit, or receive Back Office/admin emails.
// ─────────────────────────────────────────────────────────────────────────

const EDITABLE_STATUSES = ['Approved', 'Inactive', 'Rejected'];
const USER_ROLES = ['Manager', 'BackOffice', 'Admin', 'Driver', 'Developer'];
const DRIVER_BRANCH = 'All branches';

function getAllUsers(requesterEmail) {
  const requester = requireAdmin(requesterEmail);
  const requesterIsDev = requester.row[6] === 'Developer';
  const data = sheet(SHEETS.USERS).getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!String(r[3] || '').trim()) continue; // skip blank rows
    if (r[6] === 'Developer' && !requesterIsDev) continue; // developers are invisible to admins
    users.push({
      timestamp: r[0],
      fullName: r[1],
      contact: r[2],
      email: r[3],
      requestedBranch: r[4],
      status: r[5],
      role: r[6],
      branch: r[7],
      approvedBy: r[8],
      approvedDate: r[9],
      lastEditedBy: r[10] || '',
      lastEditedDate: r[11] || ''
    });
  }
  const t = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime(); };
  users.sort((a, b) => t(b.timestamp) - t(a.timestamp)); // newest registrations first
  return { success: true, users: users, branches: getBranches() };
}

function updateUser(body) {
  const requester = requireAdmin(body.requesterEmail);
  const requesterIsDev = requester.row[6] === 'Developer';
  const requesterEmail = String(body.requesterEmail || '').trim().toLowerCase();
  const target = findUserRow(body.targetEmail);
  if (!target) return { success: false, error: 'User not found.' };
  const targetIsDev = target.row[6] === 'Developer';
  if (targetIsDev && !requesterIsDev) return { success: false, error: 'User not found.' };

  const current = { status: target.row[5], role: target.row[6], branch: target.row[7] };
  if (current.status === 'Pending') {
    return { success: false, error: 'This registration is still pending — use Approve or Reject under "Pending requests".' };
  }

  const status = String(body.status || '').trim();
  const role = String(body.role || '').trim();
  const branch = String(body.branch || '').trim();

  if (EDITABLE_STATUSES.indexOf(status) === -1) {
    return { success: false, error: 'Choose a valid status.' };
  }
  if (role && USER_ROLES.indexOf(role) === -1) {
    return { success: false, error: 'Choose a valid role.' };
  }
  // Developer is only ever given through "Add developer" (which sets a
  // password), and a developer stays a developer when edited.
  if ((role === 'Developer') !== targetIsDev && role) {
    return { success: false, error: targetIsDev ? 'A developer\'s role can\'t be changed here.' : 'Developers can only be added from the Developer tab.' };
  }
  if (status === 'Approved' && (!role || !branch)) {
    return { success: false, error: 'Role and branch are required for an approved user.' };
  }

  // Guard 1: an admin can't switch off or demote their own account.
  const targetEmail = String(target.row[3]).trim().toLowerCase();
  const isSelf = targetEmail === requesterEmail;
  if (isSelf && (status !== 'Approved' || role !== requester.row[6])) {
    return { success: false, error: 'You can\'t remove your own ' + (requesterIsDev ? 'developer' : 'admin') + ' access. Ask another ' + (requesterIsDev ? 'developer' : 'admin') + ' to do it.' };
  }

  // Guard 2: never leave the app without at least one active admin.
  const wasActiveAdmin = current.status === 'Approved' && current.role === 'Admin';
  const willBeActiveAdmin = status === 'Approved' && role === 'Admin';
  if (wasActiveAdmin && !willBeActiveAdmin && getAdminEmails().length <= 1) {
    return { success: false, error: 'This is the only active Admin. Make someone else an Admin first.' };
  }
  // Guard 3: never leave the app without at least one active developer.
  if (targetIsDev && current.status === 'Approved' && status !== 'Approved' && getDeveloperRows(true).length <= 1) {
    return { success: false, error: 'This is the only active Developer.' };
  }

  // Role/branch are kept when a user is switched off, so switching them back
  // on later restores the same access.
  const newRole = role || current.role || '';
  const newBranch = newRole === 'Driver' ? DRIVER_BRANCH : (branch || current.branch || '');

  if (status === current.status && newRole === current.role && newBranch === current.branch) {
    return { success: true, unchanged: true };
  }

  const s = sheet(SHEETS.USERS);
  ensureUserAuditHeaders(s);
  const now = new Date();
  const rowIndex = target.rowIndex;

  s.getRange(rowIndex, 6, 1, 3).setValues([[status, newRole, newBranch]]); // F Status, G Role, H Branch

  // Access (re)granted → record who approved it, like the normal Approve button does.
  const accessGranted = status === 'Approved' && current.status !== 'Approved';
  if (accessGranted) {
    s.getRange(rowIndex, 9, 1, 2).setValues([[body.requesterEmail, now]]); // I ApprovedBy, J ApprovedDate
  }
  s.getRange(rowIndex, 11, 1, 2).setValues([[body.requesterEmail, now]]);  // K LastEditedBy, L LastEditedDate

  let warning = '';
  if (accessGranted) {
    try {
      MailApp.sendEmail({
        to: target.row[3],
        subject: 'You\'re approved — ' + CONFIG.ORG_NAME + ' Cash-Up app',
        body:
          'Good news — your access has been approved.\n\n' +
          'Role: ' + newRole + '\n' +
          'Branch: ' + newBranch + '\n\n' +
          'Open the app here: ' + CONFIG.APP_URL
      });
    } catch (err) {
      warning = 'Saved, but the approval email could not be sent: ' + err.message;
    }
  }

  return { success: true, warning: warning };
}

// Adds the LastEditedBy / LastEditedDate headers (columns K and L) the first
// time they're needed. Leaves the cells alone if anything is already there.
function ensureUserAuditHeaders(s) {
  const head = s.getRange(1, 11, 1, 2).getValues()[0];
  if (!head[0] && !head[1]) {
    s.getRange(1, 11, 1, 2).setValues([['LastEditedBy', 'LastEditedDate']]);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DEVELOPERS
//
// Developers see every tab, plus a Developer tab nobody else sees. They sign
// in with email + password; the password is stored only as a salted hash in
// the DevAuth sheet. A successful sign-in gives the app a session token that
// lasts 6 hours from the last use. Admins never see developer accounts and
// can't approve, edit or create them — only a developer can add a developer.
//
// FIRST DEVELOPER (one-time, from the Apps Script editor):
//   1. In the Users sheet, set your row's Role = Developer, Status = Approved.
//   2. Fill in DEV_PASSWORD_SETUP below, pick setDeveloperPasswordFromEditor
//      in the toolbar's function list and click Run.
//   3. Blank the two values again and save.
// ─────────────────────────────────────────────────────────────────────────

const DEV_PASSWORD_SETUP = { email: '', password: '' };

const DEV_SESSION_SECONDS = 6 * 60 * 60;
const DEV_MAX_FAILED_LOGINS = 5;
const DEV_LOCKOUT_SECONDS = 15 * 60;
const DEV_MIN_PASSWORD_LENGTH = 8;
const PASSWORD_HASH_ROUNDS = 200;

function setDeveloperPasswordFromEditor() {
  const email = String(DEV_PASSWORD_SETUP.email || '').trim();
  const password = String(DEV_PASSWORD_SETUP.password || '');
  if (!email || !password) throw new Error('Fill in DEV_PASSWORD_SETUP.email and .password first.');
  const found = findUserRow(email);
  if (!found || found.row[6] !== 'Developer') {
    throw new Error('No Users row with Role = Developer for ' + email + '. Set Role = Developer and Status = Approved first.');
  }
  const err = passwordProblem(password);
  if (err) throw new Error(err);
  setDevPassword(email, password, 'Apps Script editor');
  Logger.log('Developer password set for ' + email + '. Now blank DEV_PASSWORD_SETUP and save.');
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidDevSession(email) {
  if (!REQUEST_TOKEN) return false;
  const cache = CacheService.getScriptCache();
  const key = 'devsess:' + REQUEST_TOKEN;
  const who = cache.get(key);
  if (!who || who !== normEmail(email)) return false;
  cache.put(key, who, DEV_SESSION_SECONDS); // sliding expiry
  return true;
}

function devLogin(body) {
  const email = normEmail(body.email);
  const password = String(body.password || '');
  const cache = CacheService.getScriptCache();
  const failKey = 'devfail:' + email;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= DEV_MAX_FAILED_LOGINS) {
    return { success: false, error: 'Too many wrong attempts. Try again in 15 minutes.' };
  }
  const found = findUserRow(email);
  const stored = found && found.row[6] === 'Developer' && found.row[5] === 'Approved' ? getDevPasswordHash(email) : '';
  if (!stored || !verifyPassword(password, stored)) {
    cache.put(failKey, String(fails + 1), DEV_LOCKOUT_SECONDS);
    return { success: false, error: found && found.row[6] === 'Developer' && !stored && found.row[5] === 'Approved'
      ? 'No password has been set for this developer yet.'
      : 'Email or password is incorrect.' };
  }
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('devsess:' + token, email, DEV_SESSION_SECONDS);
  return { success: true, token: token };
}

function devLogout() {
  if (REQUEST_TOKEN) CacheService.getScriptCache().remove('devsess:' + REQUEST_TOKEN);
  return { success: true };
}

function addDeveloper(body) {
  const requester = requireDeveloper(body.requesterEmail);
  const email = normEmail(body.email);
  const fullName = String(body.fullName || '').trim();
  const password = String(body.password || '');
  if (!email || !fullName) return { success: false, error: 'Full name and email are required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { success: false, error: 'That email address doesn\'t look right.' };
  const pwErr = passwordProblem(password);
  if (pwErr) return { success: false, error: pwErr };
  if (findUserRow(email)) {
    return { success: false, error: 'That email is already registered in the app. Use a different email for the developer account.' };
  }
  const now = new Date();
  sheet(SHEETS.USERS).appendRow([
    now, fullName, String(body.contact || ''), email, '', 'Approved', 'Developer', 'All branches', requester.row[3], now
  ]);
  setDevPassword(email, password, requester.row[3]);
  return { success: true };
}

function changeMyPassword(body) {
  const me = requireDeveloper(body.requesterEmail);
  const stored = getDevPasswordHash(me.row[3]);
  if (!stored || !verifyPassword(String(body.currentPassword || ''), stored)) {
    return { success: false, error: 'Your current password is incorrect.' };
  }
  const pwErr = passwordProblem(String(body.newPassword || ''));
  if (pwErr) return { success: false, error: pwErr };
  setDevPassword(me.row[3], String(body.newPassword), me.row[3]);
  return { success: true };
}

function getDeveloperRows(activeOnly) {
  const data = sheet(SHEETS.USERS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][6] !== 'Developer') continue;
    if (activeOnly && data[i][5] !== 'Approved') continue;
    out.push(data[i]);
  }
  return out;
}

function passwordProblem(password) {
  if (String(password).length < DEV_MIN_PASSWORD_LENGTH) {
    return 'Password must be at least ' + DEV_MIN_PASSWORD_LENGTH + ' characters.';
  }
  return '';
}

function devAuthSheet() {
  return getOrCreateSheet(SHEETS.DEV_AUTH, ['Email', 'PasswordHash', 'UpdatedAt', 'UpdatedBy']);
}

function getDevPasswordHash(email) {
  const data = devAuthSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normEmail(data[i][0]) === normEmail(email)) return String(data[i][1] || '');
  }
  return '';
}

function setDevPassword(email, password, updatedBy) {
  const s = devAuthSheet();
  const salt = Utilities.getUuid();
  const stored = 'v1$' + PASSWORD_HASH_ROUNDS + '$' + salt + '$' + hashPassword(password, salt, PASSWORD_HASH_ROUNDS);
  const data = s.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normEmail(data[i][0]) === normEmail(email)) {
      s.getRange(i + 1, 2, 1, 3).setValues([[stored, new Date(), updatedBy]]);
      return;
    }
  }
  s.appendRow([normEmail(email), stored, new Date(), updatedBy]);
}

function hashPassword(password, salt, rounds) {
  let digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 1; i < rounds; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.base64Encode(digest) + ':' + salt, Utilities.Charset.UTF_8);
  }
  return Utilities.base64Encode(digest);
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const actual = hashPassword(password, parts[2], Number(parts[1]) || PASSWORD_HASH_ROUNDS);
  const expected = parts[3];
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function getOrCreateSheet(name, headers) {
  const book = ss();
  let s = book.getSheetByName(name);
  if (!s) {
    s = book.insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
// BUNDLES & FEATURE FLAGS
//
// Each feature belongs to a bundle. Standard features are always on. Pro
// features are on only when the Bundle is "Pro" AND the feature is ticked in
// the Developer tab. Stored in the Settings sheet; every change is logged in
// SettingsLog. To add a Pro feature later, add one line to FEATURES.
// ─────────────────────────────────────────────────────────────────────────

const BUNDLES = ['Standard', 'Pro'];
const FEATURES = [
  { key: 'shopExpenses', name: 'Shop Expenses', bundle: 'Pro', stage: 'Live',
    description: 'Store Managers record daily shop expenses with receipt photos. Sent with the cash-up as a separate PDF; listed under Submissions.' },
  { key: 'deliveries', name: 'Delivery / Collection Service', bundle: 'Pro', stage: 'Live',
    description: 'Customer deliveries and collections (approval, scheduling, driver completion with a signed delivery-note photo, failed attempts) and inter-branch transfers (approval, dispatch, receipt, discrepancies). Notifications and audit trail throughout, plus a dashboard with action lists and a printable monthly report.' },
  { key: 'collectionValue', name: 'Collection value', bundle: 'Pro', stage: 'Live', defaultOn: false, requires: 'deliveries',
    description: 'Optional estimated rand value of donated stock on each collection — entered by the driver when completing it, or added later by the branch manager or Head Office. Totals show on the deliveries dashboard, the monthly report and the downloads.' },
  { key: 'weeklyEmail', name: 'Monday deliveries email', bundle: 'Pro', stage: 'Live', requires: 'deliveries',
    description: 'Every Monday morning, Admins get last week\'s delivery numbers and the list of jobs needing attention. Needs a one-time set-up in the Apps Script editor (run setUpWeeklyEmail).' },
  { key: 'downloads', name: 'Downloads (CSV & Excel)', bundle: 'Pro', stage: 'Live',
    description: 'Admins and Back Office download their data — ledger, summaries, cash-ups, expenses, deliveries and more — as CSV files or one Excel workbook. Internal and developer tabs are never included.' },
  { key: 'hoExpenses', name: 'Head Office Finance', bundle: 'Pro', stage: 'Live',
    description: 'Head Office expenses and income on the shared category list (Admins add their own subcategories), receipts, "for branch" costs, repeat-monthly items, and an overview that drills down from category to entry — combined with branch cash-ups and shop expenses. For Admins and Back Office.' }
];

let SETTINGS_MEMO = null;

function settingsSheet() {
  return getOrCreateSheet(SHEETS.SETTINGS, ['Key', 'Value', 'UpdatedBy', 'UpdatedAt']);
}

function readSettings() {
  if (SETTINGS_MEMO) return SETTINGS_MEMO;
  const out = {};
  const s = ss().getSheetByName(SHEETS.SETTINGS);
  if (s) {
    const data = s.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) out[String(data[i][0])] = data[i][1];
    }
  }
  SETTINGS_MEMO = out;
  return out;
}

function currentBundle() {
  const b = String(readSettings().Bundle || 'Standard');
  return BUNDLES.indexOf(b) === -1 ? 'Standard' : b;
}

function featureTicked(key) {
  const v = readSettings()['Feature.' + key];
  if (v === '' || v === undefined || v === null) { // not chosen yet: the feature's default
    const def = FEATURES.filter((f) => f.key === key)[0];
    return !def || def.defaultOn !== false;
  }
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function getEnabledFeatures() {
  const pro = currentBundle() === 'Pro';
  const out = {};
  FEATURES.forEach((f) => { out[f.key] = f.bundle === 'Standard' || (pro && featureTicked(f.key)); });
  FEATURES.forEach((f) => { if (f.requires && !out[f.requires]) out[f.key] = false; }); // add-ons need their parent
  return out;
}

function isFeatureOn(key) {
  return getEnabledFeatures()[key] === true;
}

function getDevSettings(email) {
  requireDeveloper(email);
  const enabled = getEnabledFeatures();
  const logSheet = ss().getSheetByName(SHEETS.SETTINGS_LOG);
  const log = [];
  if (logSheet) {
    const data = logSheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1 && log.length < 15; i--) {
      log.push({ timestamp: data[i][0], email: data[i][1], change: data[i][2] });
    }
  }
  const developers = getDeveloperRows(false).map((r) => ({
    fullName: r[1], email: r[3], status: r[5], hasPassword: !!getDevPasswordHash(r[3])
  }));
  return {
    success: true,
    bundle: currentBundle(),
    bundles: BUNDLES,
    features: FEATURES.map((f) => ({
      key: f.key, name: f.name, bundle: f.bundle, stage: f.stage, description: f.description,
      ticked: featureTicked(f.key), enabled: enabled[f.key],
      requires: f.requires ? FEATURES.filter((x) => x.key === f.requires)[0].name : ''
    })),
    log: log,
    developers: developers,
    weeklyEmailScheduled: weeklyEmailScheduled()
  };
}

function saveDevSettings(body) {
  const me = requireDeveloper(body.requesterEmail);
  const bundle = String(body.bundle || '');
  if (BUNDLES.indexOf(bundle) === -1) return { success: false, error: 'Choose a valid bundle.' };
  const ticks = body.features || {};

  const changes = [];
  const oldBundle = currentBundle();
  if (bundle !== oldBundle) changes.push('Bundle: ' + oldBundle + ' → ' + bundle);
  const updates = [['Bundle', bundle]];
  FEATURES.forEach((f) => {
    if (!(f.key in ticks)) return;
    const next = ticks[f.key] === true;
    if (next !== featureTicked(f.key)) changes.push(f.name + ': ' + (next ? 'ticked' : 'unticked'));
    updates.push(['Feature.' + f.key, next]);
  });
  if (changes.length === 0) return { success: true, unchanged: true };

  const s = settingsSheet();
  const data = s.getDataRange().getValues();
  const rowOf = {};
  for (let i = 1; i < data.length; i++) rowOf[String(data[i][0])] = i + 1;
  const now = new Date();
  updates.forEach((u) => {
    if (rowOf[u[0]]) s.getRange(rowOf[u[0]], 2, 1, 3).setValues([[u[1], me.row[3], now]]);
    else { s.appendRow([u[0], u[1], me.row[3], now]); rowOf[u[0]] = s.getLastRow(); }
  });
  const log = getOrCreateSheet(SHEETS.SETTINGS_LOG, ['Timestamp', 'Email', 'Change']);
  changes.forEach((c) => log.appendRow([now, me.row[3], c]));
  SETTINGS_MEMO = null;
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// SHOP EXPENSES (Pro feature "shopExpenses")
// Entered on the Store Manager's "Shop Expenses" tab and sent together with
// that day's cash-up. Each line can carry one receipt photo (saved to Drive).
// If there are any lines, a separate Shop Expenses PDF is attached to the
// cash-up email; if there are none, no PDF.
// ─────────────────────────────────────────────────────────────────────────

const MAX_EXPENSE_LINES = 15;
const SHOP_EXPENSE_HEADERS = ['SubmissionID', 'SubmittedAt', 'Branch', 'CashUpDate', 'ExpenseDate', 'Description',
  'Amount', 'Type', 'ReceiptUrl', 'ExpensesPdfUrl', 'SubmittedBy',
  // Shared category list (added with Head Office Finance; filled in automatically):
  'CategoryKey', 'SubID', 'Category', 'Subcategory'];

// Returns { lines } or { error }.
function cleanShopExpenses(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_EXPENSE_LINES) return { error: 'A maximum of ' + MAX_EXPENSE_LINES + ' shop expenses can be sent with one cash-up.' };
  const lines = [];
  for (let i = 0; i < list.length; i++) {
    const x = list[i] || {};
    const description = String(x.description || '').trim();
    const amount = Number(x.amount) || 0;
    if (!description && !amount && !x.receiptImage) continue; // blank line
    if (!description || amount <= 0) {
      return { error: 'Shop expense ' + (i + 1) + ' needs a description and an amount.' };
    }
    const img = String(x.receiptImage || '');
    // Shared category list (category + subcategory). Older app versions
    // still send one of the five original types, which are mapped across.
    const cats = finCategories();
    let sub = cats.subsById[String(x.subId || '')];
    if (!sub && !x.subId && x.type) sub = cats.subsById[LEGACY_SHOP_TYPES[x.type] || 'other.sundry'];
    if (!sub || sub.auto || sub.kind !== 'Expense') {
      return { error: 'Choose a category for shop expense ' + (i + 1) + '.' };
    }
    const major = finMajor(sub.majorKey);
    lines.push({
      date: String(x.date || ''),
      description: description,
      amount: amount,
      type: sub.name,
      categoryKey: major.key,
      subId: sub.id,
      category: major.name,
      subcategory: sub.name,
      receiptImage: /^data:image\/(jpeg|png|webp);base64,/.test(img) ? img : ''
    });
  }
  return { lines: lines };
}

function getDriveFolder(path) {
  let folder = null;
  path.forEach((name, i) => {
    const iter = i === 0 ? DriveApp.getFoldersByName(name) : folder.getFoldersByName(name);
    folder = iter.hasNext() ? iter.next() : (i === 0 ? DriveApp.createFolder(name) : folder.createFolder(name));
  });
  return folder;
}

function saveReceiptImage(dataUrl, branch, submissionId, lineNo) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return '';
  const ext = m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1],
    'Receipt_' + String(branch).replace(/\s+/g, '') + '_' + submissionId + '_' + lineNo + '.' + ext);
  return getDriveFolder(['Vision CashUp Receipts', String(branch || 'Unknown branch')]).createFile(blob).getUrl();
}

function buildShopExpensesPdf(d, submissionId, lines) {
  const esc = function (v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  const rand = function (v) {
    const parts = Number(v || 0).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return 'R ' + parts.join('.');
  };
  let logoImg = '';
  try {
    const logoBlob = UrlFetchApp.fetch(CONFIG.LOGO_URL).getBlob();
    logoImg = 'data:' + logoBlob.getContentType() + ';base64,' + Utilities.base64Encode(logoBlob.getBytes());
  } catch (err) { logoImg = ''; }

  let total = 0;
  const rows = lines.map(function (x, i) {
    total += x.amount;
    return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.date) + '</td><td>' + esc(x.description) + '</td><td>' +
      esc(x.category ? x.category + ' › ' + x.subcategory : x.type) +
      '</td><td style="text-align:right;">' + rand(x.amount) + '</td><td>' + (x.receiptImage ? 'Attached' : '—') + '</td></tr>';
  }).join('');

  const receiptPages = lines.map(function (x, i) {
    if (!x.receiptImage) return '';
    return '<div class="receipt-page"><div class="section-title">RECEIPT — LINE ' + (i + 1) + ': ' + esc(x.description) +
      ' (' + rand(x.amount) + ')</div><img src="' + x.receiptImage + '" /></div>';
  }).join('');

  const html =
    '<html><head><style>' +
    '@page{size:A4;margin:9mm;}' +
    'body{font-family:Arial,sans-serif;font-size:9.5px;color:#1a1a1a;}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:6px;}' +
    'td,th{border:1px solid #333;padding:3px 5px;text-align:left;line-height:1.25;}' +
    'th{background:#f0f0f0;}' +
    '.brand{color:#E6007E;font-size:16px;font-weight:bold;}' +
    '.section-title{background:#1a1a1a;color:#fff;padding:2px 5px;font-weight:bold;margin-top:4px;}' +
    '.total-row{font-weight:bold;background:#f7f7f7;}' +
    '.receipt-page{page-break-before:always;padding-top:6px;text-align:center;}' +
    '.receipt-page img{max-width:100%;max-height:262mm;width:auto;height:auto;margin-top:6px;}' +
    '</style></head><body>' +
    '<table style="border:none;width:100%;margin-bottom:6px;"><tr>' +
    '<td style="border:none;width:60%;vertical-align:middle;">' + (logoImg ? '<img src="' + logoImg + '" height="80"/>' : '<div class="brand">' + CONFIG.ORG_NAME + '</div>') + '</td>' +
    '<td style="border:none;width:40%;text-align:right;vertical-align:middle;"><h2 style="margin:0;font-size:15px;">SHOP EXPENSES</h2></td>' +
    '</tr></table>' +
    '<table><tr><td><b>Branch</b></td><td>' + esc(d.branch) + '</td><td><b>Cash-up date</b></td><td>' + esc(d.date) + ' (' + esc(d.day) + ')</td><td><b>Manager</b></td><td>' + esc(d.managerName) + '</td></tr></table>' +
    '<div class="section-title">EXPENSES</div>' +
    '<table><tr><th>#</th><th>Date</th><th>Description</th><th>Category</th><th style="text-align:right;">Amount</th><th>Receipt</th></tr>' +
    rows +
    '<tr class="total-row"><td colspan="4">TOTAL SHOP EXPENSES</td><td style="text-align:right;">' + rand(total) + '</td><td></td></tr>' +
    '</table>' +
    '<p style="color:#666;font-size:9px;">Submission ID: ' + esc(submissionId) + '</p>' +
    receiptPages +
    '</body></html>';

  return Utilities.newBlob(html, 'text/html', 'shop-expenses.html').getAs('application/pdf');
}

function getShopExpenseSubmissions(email, branch) {
  requireAdminOrBackOffice(email);
  if (!isFeatureOn('shopExpenses')) return { success: true, enabled: false, submissions: [] };
  const s = ss().getSheetByName(SHEETS.SHOP_EXPENSES);
  if (!s) return { success: true, enabled: true, submissions: [] };
  const data = s.getDataRange().getValues();
  const byId = {};
  const order = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const r = data[i];
    const id = r[0];
    if (!id) continue;
    if (!byId[id]) {
      if (order.length >= 30) continue;
      byId[id] = { submissionId: id, submittedAt: r[1], branch: r[2], cashUpDate: r[3],
        pdfFile: r[9] ? { t: 'shopPdf', r: id } : null, submittedBy: r[10], total: 0, lines: [] };
      order.push(id);
    }
    byId[id].lines.unshift({ expenseDate: r[4], description: r[5], amount: Number(r[6]) || 0,
      type: r[13] && r[14] ? r[13] + ' › ' + r[14] : r[7], hasReceipt: !!r[8] });
    byId[id].total += Number(r[6]) || 0;
  }
  // Receipts are opened in the app by submission + line number, never by link.
  order.forEach((id) => byId[id].lines.forEach((l, i) => {
    l.receiptFile = l.hasReceipt ? { t: 'shopReceipt', r: id, l: i + 1 } : null;
    delete l.hasReceipt;
  }));
  return { success: true, enabled: true, submissions: order.map((id) => byId[id]) };
}

// ─────────────────────────────────────────────────────────────────────────
// DELIVERIES, COLLECTIONS & INTER-BRANCH TRANSFERS (Pro feature "deliveries") — STAGES 1–3
//
// Branch staff log a customer delivery or collection; it starts as
// "Pending Approval". Head Office (Admins, and Developers) approve it,
// schedule it with a driver, put it on hold, resume or cancel it. Every
// status change is written to JobHistory. Admins get an in-app notification
// and an email for each new request; drivers get one when assigned.
//
// Who sees what (enforced here, not just in the app):
//   Admin / Developer / Back Office → every job (Back Office view-only)
//   Store Manager                   → jobs for their own branch
//   Driver                          → jobs assigned to them
//
// Stage 2: the assigned driver (or Head Office on their behalf) starts the
// job, marks it Completed with a photo of the signed delivery note as proof
// (saved to Drive), or records a Failed attempt with a reason — which stays
// open for Head Office to reschedule or cancel.
// Stage 3: inter-branch transfers (IBT-00001). A branch (or Head Office)
// requests stock lines to move from a sending to a receiving branch →
// Head Office approves → the sending branch confirms what was actually
// dispatched (and by which driver/person) → the driver marks it delivered →
// the receiving branch confirms what arrived and its condition. Any short,
// extra or damaged line becomes a discrepancy that Head Office must resolve
// before the transfer is Completed.
// Stage 4: a dashboard with action lists (Deliveries tab), a printable
// monthly report, an optional estimated value on collections, and a Monday
// summary email to Admins.
// ─────────────────────────────────────────────────────────────────────────

const JOB_TYPES = { Delivery: 'DEL', Collection: 'COL', Transfer: 'IBT' };
const CUSTOMER_JOB_TYPES = ['Delivery', 'Collection'];
const TRANSFER_TYPES = ['Transfer'];
const ALL_JOB_TYPES = ['Delivery', 'Collection', 'Transfer'];
const IBT_MAX_LINES = 20;
const IBT_CONDITIONS = ['Good', 'Damaged'];
const JOB_ITEM_CATEGORIES = ['Appliance', 'Furniture', 'Books', 'Clothing', 'Art', 'Other'];
const JOB_FINAL_STATUSES = ['Completed', 'Cancelled'];
const JOB_HEADERS = ['Ref', 'Type', 'Status', 'CreatedAt', 'CreatedBy', 'Branch', 'CustomerName', 'CustomerContact',
  'Address', 'ItemCategory', 'ItemDescription', 'RequiredDate', 'Instructions', 'DriverEmail', 'ScheduledDate',
  'ApprovedBy', 'ApprovedAt', 'UpdatedAt', 'UpdatedBy', 'HoldFromStatus', 'CompletedAt', 'CompletedBy', 'ProofUrl',
  'CompletionNotes', 'LastFailReason', 'ClientRequestId',
  // Inter-branch transfers (added in stage 3 — the header cells are filled in automatically):
  'ReceivingBranch', 'Reason', 'DispatchDate', 'DispatchedBy', 'ResponsiblePerson', 'ReceivedAt', 'ReceivedBy', 'ResolutionNotes',
  // Stage 4 (optional "collectionValue" feature): estimated rand value of a collection.
  'CollectionValue'];
const JOB_ITEM_HEADERS = ['Ref', 'Line', 'Category', 'Description', 'QtyRequested', 'QtyDispatched', 'QtyReceived', 'Condition', 'Discrepancy', 'Notes'];
const JC = {}; // header name -> 0-based column index
JOB_HEADERS.forEach((h, i) => { JC[h] = i; });
const JOB_HISTORY_HEADERS = ['Timestamp', 'Ref', 'FromStatus', 'ToStatus', 'ByEmail', 'Notes'];
const NOTIFICATION_HEADERS = ['ID', 'Timestamp', 'Recipient', 'Ref', 'Message', 'ReadAt'];

// The only status moves allowed. "office" = Admin or Developer;
// "driver" = the driver assigned to the job (Head Office can also do these
// on the driver's behalf, e.g. if the driver's phone is off).
// "sending" / "receiving" = a Store Manager of the transfer's sending /
// receiving branch. Head Office can always act on anyone's behalf.
const JOB_ACTIONS = {
  // Deliveries & collections
  start:    { label: 'Start job',           types: CUSTOMER_JOB_TYPES, from: ['Scheduled'], to: 'In Progress', who: 'driver' },
  complete: { label: 'Mark completed',      types: CUSTOMER_JOB_TYPES, from: ['Scheduled', 'In Progress'], to: 'Completed', who: 'driver' },
  fail:     { label: 'Couldn\'t complete', types: CUSTOMER_JOB_TYPES, from: ['Scheduled', 'In Progress'], to: 'Failed Attempt', who: 'driver' },
  schedule: { label: 'Schedule',            types: CUSTOMER_JOB_TYPES, from: ['Approved', 'Scheduled', 'Failed Attempt'], to: 'Scheduled' },
  // Inter-branch transfers
  dispatch: { label: 'Confirm dispatch',    types: TRANSFER_TYPES, from: ['Awaiting Dispatch'], to: 'Dispatched', who: 'sending' },
  deliver:  { label: 'Delivered to branch', types: TRANSFER_TYPES, from: ['Dispatched'], to: 'Awaiting Receipt', who: 'driver' },
  receive:  { label: 'Confirm receipt',     types: TRANSFER_TYPES, from: ['Dispatched', 'Awaiting Receipt'], to: null, who: 'receiving' },
  resolve:  { label: 'Resolve discrepancy', types: TRANSFER_TYPES, from: ['Discrepancy Reported'], to: 'Completed', needsNotes: true },
  // All job types
  approve:  { label: 'Approve',     types: ALL_JOB_TYPES, from: ['Pending Approval'], to: null }, // Approved, or Awaiting Dispatch for a transfer
  hold:     { label: 'Put on hold', types: ALL_JOB_TYPES, from: ['Pending Approval', 'Approved', 'Awaiting Dispatch', 'Scheduled', 'In Progress', 'Failed Attempt'], to: 'On Hold', needsNotes: true },
  resume:   { label: 'Resume',      types: ALL_JOB_TYPES, from: ['On Hold'], to: null }, // back to the status it was on hold from
  cancel:   { label: 'Cancel job',  types: ALL_JOB_TYPES, from: ['Pending Approval', 'Approved', 'Awaiting Dispatch', 'Scheduled', 'Failed Attempt', 'On Hold'], to: 'Cancelled', needsNotes: true }
};
const JOB_FAIL_REASONS = ['Customer not available', 'Wrong or incomplete address', 'Customer refused the item',
  'Access problem (stairs, size, parking)', 'Vehicle problem', 'Other'];

// Also fills in any header cells added in later stages (e.g. the transfer
// columns), so an existing Jobs sheet keeps working without manual edits.
let JOBS_SHEET_MEMO = null;
function jobsSheet() {
  if (JOBS_SHEET_MEMO) return JOBS_SHEET_MEMO;
  const s = getOrCreateSheet(SHEETS.JOBS, JOB_HEADERS);
  const head = s.getRange(1, 1, 1, JOB_HEADERS.length).getValues()[0];
  JOB_HEADERS.forEach((h, i) => { if (!head[i]) s.getRange(1, i + 1).setValue(h).setFontWeight('bold'); });
  JOBS_SHEET_MEMO = s;
  return s;
}
function jobItemsSheet() { return getOrCreateSheet(SHEETS.JOB_ITEMS, JOB_ITEM_HEADERS); }

function isOfficeRole(role) { return role === 'Admin' || role === 'Developer'; }

// The signed-in user for any Deliveries request, or an error.
function jobsActor(email) {
  if (!isFeatureOn('deliveries')) throw new Error('Deliveries is not switched on.');
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved' ||
      ['Admin', 'Developer', 'BackOffice', 'Manager', 'Driver'].indexOf(found.row[6]) === -1) {
    throw new Error('Not authorized.');
  }
  return { email: normEmail(found.row[3]), name: found.row[1], role: found.row[6], branch: found.row[7] };
}

function canSeeJob(actor, job) {
  if (isOfficeRole(actor.role) || actor.role === 'BackOffice') return true;
  if (actor.role === 'Manager') return job.branch === actor.branch || job.receivingBranch === actor.branch;
  if (actor.role === 'Driver') return normEmail(job.driverEmail) === actor.email;
  return false;
}

function isDateValue(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function dayString(v) {
  if (isDateValue(v)) return Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return String(v || '').replace(/^'/, '');
}
function todayString() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }

function jobFromRow(r) {
  const text = (h) => String(r[JC[h]] === undefined || r[JC[h]] === null ? '' : r[JC[h]]).replace(/^'/, '');
  const job = {
    ref: text('Ref'), type: text('Type'), status: text('Status'),
    createdAt: r[JC.CreatedAt], createdBy: text('CreatedBy'), branch: text('Branch'),
    customerName: text('CustomerName'), customerContact: text('CustomerContact'), address: text('Address'),
    itemCategory: text('ItemCategory'), itemDescription: text('ItemDescription'),
    requiredDate: dayString(r[JC.RequiredDate]), instructions: text('Instructions'),
    driverEmail: text('DriverEmail'), scheduledDate: dayString(r[JC.ScheduledDate]),
    approvedBy: text('ApprovedBy'), approvedAt: r[JC.ApprovedAt] || '',
    updatedAt: r[JC.UpdatedAt] || '', updatedBy: text('UpdatedBy'), holdFromStatus: text('HoldFromStatus'),
    completedAt: r[JC.CompletedAt] || '', completedBy: text('CompletedBy'), proofUrl: text('ProofUrl'),
    completionNotes: text('CompletionNotes'), lastFailReason: text('LastFailReason'),
    receivingBranch: text('ReceivingBranch'), reason: text('Reason'), dispatchDate: dayString(r[JC.DispatchDate]),
    dispatchedBy: text('DispatchedBy'), responsiblePerson: text('ResponsiblePerson'),
    receivedAt: r[JC.ReceivedAt] || '', receivedBy: text('ReceivedBy'), resolutionNotes: text('ResolutionNotes'),
    collectionValue: r[JC.CollectionValue] === '' || r[JC.CollectionValue] === null || r[JC.CollectionValue] === undefined ||
      isNaN(Number(r[JC.CollectionValue])) ? null : Number(r[JC.CollectionValue])
  };
  job.overdue = !!job.requiredDate && JOB_FINAL_STATUSES.indexOf(job.status) === -1 && job.requiredDate < todayString();
  return job;
}

// Returns { rowIndex, job } or null.
function findJob(ref) {
  const data = jobsSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][JC.Ref]) === String(ref)) return { rowIndex: i + 1, job: jobFromRow(data[i]) };
  }
  return null;
}

// Writes only the given cells, so text like phone numbers keeps its format.
function setJobCells(rowIndex, values) {
  const s = jobsSheet();
  Object.keys(values).forEach((h) => { s.getRange(rowIndex, JC[h] + 1).setValue(values[h]); });
}

function addJobHistory(ref, fromStatus, toStatus, byEmail, notes) {
  getOrCreateSheet(SHEETS.JOB_HISTORY, JOB_HISTORY_HEADERS)
    .appendRow([new Date(), ref, fromStatus || '', toStatus, byEmail, notes || '']);
}

function nextJobRef(prefix) {
  const data = jobsSheet().getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(String(data[i][JC.Ref]));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + '-' + String(max + 1).padStart(5, '0');
}

function approvedDrivers() {
  const data = sheet(SHEETS.USERS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === 'Approved' && data[i][6] === 'Driver') out.push({ email: normEmail(data[i][3]), fullName: data[i][1] });
  }
  return out;
}

function userName(email) {
  const f = findUserRow(email);
  return f ? f.row[1] : email;
}

function jobActionsFor(actor, job) {
  const out = [];
  Object.keys(JOB_ACTIONS).forEach((key) => {
    const a = JOB_ACTIONS[key];
    if (a.types.indexOf(job.type) === -1 || a.from.indexOf(job.status) === -1) return;
    const isManager = actor.role === 'Manager';
    const officeOk = isOfficeRole(actor.role);
    const driverOk = a.who === 'driver' && actor.role === 'Driver' && normEmail(job.driverEmail) === actor.email;
    const sendingOk = a.who === 'sending' && isManager && actor.branch === job.branch;
    const receivingOk = a.who === 'receiving' && isManager && actor.branch === job.receivingBranch;
    const branchCancelOk = key === 'cancel' && isManager && job.status === 'Pending Approval' &&
      (job.createdBy === actor.email || job.branch === actor.branch);
    if (officeOk || driverOk || sendingOk || receivingOk || branchCancelOk) {
      let label = a.label;
      if (key === 'schedule' && job.status !== 'Approved') label = 'Reschedule';
      if (key === 'deliver') label = 'Delivered to ' + job.receivingBranch;
      if (key === 'cancel' && job.type === 'Transfer') label = 'Cancel transfer';
      out.push({ key: key, label: label, needsNotes: !!a.needsNotes });
    }
  });
  return out;
}

// What the app gets for a job: the proof photo is opened through getFile,
// never by its Drive link.
function publicJob(job) {
  const out = Object.assign({}, job);
  if (out.type !== 'Collection' || !isFeatureOn('collectionValue')) delete out.collectionValue;
  out.proofFile = job.proofUrl ? { t: 'proof', r: job.ref } : null;
  delete out.proofUrl;
  return out;
}

function branchManagers(branch) {
  const data = sheet(SHEETS.USERS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === 'Approved' && data[i][6] === 'Manager' && data[i][7] === branch) out.push(normEmail(data[i][3]));
  }
  return out;
}

// Returns the item lines of a transfer, each with its sheet row number.
function readJobItems(ref) {
  const s = ss().getSheetByName(SHEETS.JOB_ITEMS);
  if (!s) return [];
  const data = s.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(ref)) continue;
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    out.push({
      rowIndex: i + 1, line: Number(data[i][1]), category: data[i][2], description: data[i][3],
      qtyRequested: num(data[i][4]), qtyDispatched: num(data[i][5]), qtyReceived: num(data[i][6]),
      condition: data[i][7] || '', discrepancy: data[i][8] || '', notes: data[i][9] || ''
    });
  }
  return out.sort((a, b) => a.line - b.line);
}

function wholeQty(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null;
}

function getJobs(email) {
  const actor = jobsActor(email);
  const data = jobsSheet().getDataRange().getValues();
  const open = [];
  const closed = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][JC.Ref]) continue;
    const job = jobFromRow(data[i]);
    if (!canSeeJob(actor, job)) continue;
    (JOB_FINAL_STATUSES.indexOf(job.status) === -1 ? open : closed).push(job);
  }
  const office = isOfficeRole(actor.role);
  const names = {};
  const users = sheet(SHEETS.USERS).getDataRange().getValues();
  for (let i = 1; i < users.length; i++) names[normEmail(users[i][3])] = users[i][1];
  open.concat(closed).forEach((j) => { j.driverName = j.driverEmail ? (names[normEmail(j.driverEmail)] || j.driverEmail) : ''; });
  return {
    success: true,
    role: actor.role,
    canCreate: ['Manager', 'Admin', 'Developer'].indexOf(actor.role) !== -1,
    isOffice: office,
    myBranch: actor.branch,
    jobs: open.concat(closed.slice(-300)).map(publicJob),
    branches: getBranches(),
    categories: JOB_ITEM_CATEGORIES,
    drivers: office ? approvedDrivers() : []
  };
}

function getJob(email, ref) {
  const actor = jobsActor(email);
  const found = findJob(ref);
  if (!found || !canSeeJob(actor, found.job)) return { success: false, error: 'Job not found.' };
  const history = [];
  const hs = ss().getSheetByName(SHEETS.JOB_HISTORY);
  if (hs) {
    const data = hs.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(ref)) {
        history.push({ timestamp: data[i][0], fromStatus: data[i][2], toStatus: data[i][3], by: data[i][4], notes: data[i][5] });
      }
    }
  }
  const job = found.job;
  job.driverName = job.driverEmail ? userName(job.driverEmail) : '';
  const actions = jobActionsFor(actor, job);
  const canPickDriver = actions.some((a) => a.key === 'schedule' || a.key === 'dispatch');
  return {
    success: true,
    job: publicJob(job),
    history: history,
    actions: actions,
    items: job.type === 'Transfer' ? readJobItems(job.ref).map((x) => { delete x.rowIndex; return x; }) : [],
    conditions: IBT_CONDITIONS,
    drivers: canPickDriver ? approvedDrivers() : [],
    failReasons: JOB_FAIL_REASONS,
    completedByName: job.completedBy ? userName(job.completedBy) : '',
    valueOn: job.type === 'Collection' && isFeatureOn('collectionValue'),
    canSetValue: job.type === 'Collection' && job.status === 'Completed' && isFeatureOn('collectionValue') &&
      (isOfficeRole(actor.role) || (actor.role === 'Manager' && actor.branch === job.branch))
  };
}

function createJob(body) {
  const actor = jobsActor(body.requesterEmail);
  if (['Manager', 'Admin', 'Developer'].indexOf(actor.role) === -1) {
    return { success: false, error: 'Your role can\'t create delivery or collection requests.' };
  }
  const prefix = JOB_TYPES[body.type];
  if (!prefix) return { success: false, error: 'Choose Delivery, Collection or Transfer.' };
  if (body.type === 'Transfer') return createTransfer(actor, body);

  const f = {};
  ['customerName', 'customerContact', 'address', 'itemCategory', 'itemDescription', 'requiredDate', 'instructions', 'branch', 'clientRequestId']
    .forEach((k) => { f[k] = String(body[k] || '').trim(); });
  if (!f.customerName || !f.customerContact || !f.address || !f.itemDescription) {
    return { success: false, error: 'Customer name, contact number, address and item description are required.' };
  }
  if (JOB_ITEM_CATEGORIES.indexOf(f.itemCategory) === -1) return { success: false, error: 'Choose an item category.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.requiredDate)) return { success: false, error: 'Choose the required date.' };
  const branch = actor.role === 'Manager' ? actor.branch : f.branch;
  if (getBranches().indexOf(branch) === -1) return { success: false, error: 'Choose a valid branch.' };

  // Same form submitted twice (double tap, retry after a dropped connection)?
  // Return the job that was already created instead of making a second one.
  const s = jobsSheet();
  const dup = findJobByRequestId(f.clientRequestId);
  if (dup) return { success: true, ref: dup, duplicate: true };

  const ref = nextJobRef(prefix);
  const now = new Date();
  const row = JOB_HEADERS.map(() => '');
  row[JC.Ref] = ref;
  row[JC.Type] = body.type;
  row[JC.Status] = 'Pending Approval';
  row[JC.CreatedAt] = now;
  row[JC.CreatedBy] = actor.email;
  row[JC.Branch] = branch;
  row[JC.CustomerName] = f.customerName;
  row[JC.CustomerContact] = "'" + f.customerContact; // keep leading zeros
  row[JC.Address] = f.address;
  row[JC.ItemCategory] = f.itemCategory;
  row[JC.ItemDescription] = f.itemDescription;
  row[JC.RequiredDate] = "'" + f.requiredDate;
  row[JC.Instructions] = f.instructions;
  row[JC.UpdatedAt] = now;
  row[JC.UpdatedBy] = actor.email;
  row[JC.ClientRequestId] = f.clientRequestId;
  s.appendRow(row);
  addJobHistory(ref, '', 'Pending Approval', actor.email, 'Request created');

  const kind = body.type.toLowerCase();
  const admins = getAdminEmails();
  notifyUsers(admins, ref, 'New ' + kind + ' request ' + ref + ' from ' + branch + ' needs approval.', actor.email);
  const warning = sendJobEmail(admins.filter((e) => normEmail(e) !== actor.email),
    'New ' + kind + ' request ' + ref + ' — ' + branch + ' (needs approval)',
    'A new ' + kind + ' request has been logged and needs approval.\n\n' +
    'Reference: ' + ref + '\n' +
    'Branch: ' + branch + '\n' +
    'Customer: ' + f.customerName + '\n' +
    'Item: ' + f.itemCategory + ' — ' + f.itemDescription + '\n' +
    'Required by: ' + f.requiredDate + '\n' +
    'Logged by: ' + actor.name + ' (' + actor.email + ')\n\n' +
    'Open it in the app: ' + CONFIG.APP_URL + '#job=' + ref);

  return { success: true, ref: ref, warning: warning };
}

function findJobByRequestId(id) {
  if (!id) return null;
  const data = jobsSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][JC.ClientRequestId]) === id) return String(data[i][JC.Ref]);
  }
  return null;
}

function createTransfer(actor, body) {
  const branches = getBranches();
  const from = String(body.sendingBranch || '').trim();
  const to = String(body.receivingBranch || '').trim();
  const reason = String(body.reason || '').trim().slice(0, 500);
  const date = String(body.requiredDate || '').trim();
  const requestId = String(body.clientRequestId || '').trim();
  if (branches.indexOf(from) === -1 || branches.indexOf(to) === -1) return { success: false, error: 'Choose the sending and receiving branches.' };
  if (from === to) return { success: false, error: 'The sending and receiving branches must be different.' };
  if (actor.role === 'Manager' && actor.branch !== from && actor.branch !== to) {
    return { success: false, error: 'You can only request transfers to or from your own branch (' + actor.branch + ').' };
  }
  if (!reason) return { success: false, error: 'Give a reason for the transfer.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: 'Choose the requested transfer date.' };

  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return { success: false, error: 'Add at least one item.' };
  if (raw.length > IBT_MAX_LINES) return { success: false, error: 'A transfer can have at most ' + IBT_MAX_LINES + ' item lines.' };
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const category = String((raw[i] || {}).category || '');
    const description = String((raw[i] || {}).description || '').trim().slice(0, 200);
    const qty = wholeQty((raw[i] || {}).qty);
    if (JOB_ITEM_CATEGORIES.indexOf(category) === -1 || !description || !qty) {
      return { success: false, error: 'Item ' + (i + 1) + ' needs a category, a description and a quantity of at least 1.' };
    }
    items.push({ category, description, qty });
  }

  const dup = findJobByRequestId(requestId);
  if (dup) return { success: true, ref: dup, duplicate: true };

  const ref = nextJobRef(JOB_TYPES.Transfer);
  const now = new Date();
  const totalQty = items.reduce((t, x) => t + x.qty, 0);
  const cats = items.map((x) => x.category).filter((c, i, a) => a.indexOf(c) === i);
  const row = JOB_HEADERS.map(() => '');
  row[JC.Ref] = ref;
  row[JC.Type] = 'Transfer';
  row[JC.Status] = 'Pending Approval';
  row[JC.CreatedAt] = now;
  row[JC.CreatedBy] = actor.email;
  row[JC.Branch] = from;
  row[JC.ReceivingBranch] = to;
  row[JC.ItemCategory] = cats.length === 1 ? cats[0] : 'Mixed';
  row[JC.ItemDescription] = totalQty + ' item' + (totalQty === 1 ? '' : 's') + ' in ' + items.length + ' line' + (items.length === 1 ? '' : 's') +
    ' (' + cats.join(', ') + ')';
  row[JC.RequiredDate] = "'" + date;
  row[JC.Reason] = reason;
  row[JC.UpdatedAt] = now;
  row[JC.UpdatedBy] = actor.email;
  row[JC.ClientRequestId] = requestId;
  jobsSheet().appendRow(row);

  const itemSheet = jobItemsSheet();
  const itemRows = items.map((x, i) => [ref, i + 1, x.category, x.description, x.qty, '', '', '', '', '']);
  itemSheet.getRange(itemSheet.getLastRow() + 1, 1, itemRows.length, JOB_ITEM_HEADERS.length).setValues(itemRows);
  addJobHistory(ref, '', 'Pending Approval', actor.email, 'Transfer requested: ' + from + ' → ' + to + ' · ' + row[JC.ItemDescription]);

  const admins = getAdminEmails();
  notifyUsers(admins, ref, 'New inter-branch transfer ' + ref + ' (' + from + ' → ' + to + ') needs approval.', actor.email);
  const warning = sendJobEmail(admins.filter((e) => normEmail(e) !== actor.email),
    'New inter-branch transfer ' + ref + ' — ' + from + ' → ' + to + ' (needs approval)',
    'A new inter-branch transfer has been requested and needs approval.\n\n' +
    'Reference: ' + ref + '\n' +
    'From: ' + from + '\n' +
    'To: ' + to + '\n' +
    'Requested date: ' + date + '\n' +
    'Reason: ' + reason + '\n' +
    'Items:\n' + items.map((x) => '  • ' + x.qty + ' × ' + x.description + ' (' + x.category + ')').join('\n') + '\n' +
    'Requested by: ' + actor.name + ' (' + actor.email + ')\n\n' +
    'Open it in the app: ' + CONFIG.APP_URL + '#job=' + ref);
  return { success: true, ref: ref, warning: warning };
}

function jobAction(body) {
  const actor = jobsActor(body.requesterEmail);
  const found = findJob(body.ref);
  if (!found || !canSeeJob(actor, found.job)) return { success: false, error: 'Job not found.' };
  const job = found.job;
  const key = String(body.step || ''); // see JOB_ACTIONS
  const def = JOB_ACTIONS[key];
  if (!def) return { success: false, error: 'Unknown action.' };
  if (!jobActionsFor(actor, job).some((a) => a.key === key)) {
    return { success: false, error: def.from.indexOf(job.status) === -1
      ? 'This job is "' + job.status + '" — that action isn\'t possible any more. Refresh to see the latest.'
      : 'You don\'t have permission to do that.' };
  }
  const notes = String(body.notes || '').trim().slice(0, 1000);
  if (def.needsNotes && !notes) return { success: false, error: 'Please add a reason.' };

  const now = new Date();
  const cells = { UpdatedAt: now, UpdatedBy: actor.email };
  let toStatus = def.to;
  let historyNotes = notes;
  const creator = job.createdBy;
  const isTransfer = job.type === 'Transfer';
  // Everyone involved in this job (for hold / resume / cancel notices).
  const parties = [creator, job.driverEmail].concat(isTransfer ? branchManagers(job.branch).concat(branchManagers(job.receivingBranch)) : []);
  const messages = []; // [recipients[], message]
  let transferEmail = null;
  let emailDriver = null;
  let failEmail = null;

  if (key === 'start') {
    messages.push([[creator], job.ref + ' is on its way — ' + actor.name + ' has started the ' + job.type.toLowerCase() + '.']);
  } else if (key === 'complete') {
    // Proof is required: a photo of the delivery note signed by the customer.
    const proof = String(body.proofImage || '');
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(proof)) {
      return { success: false, error: 'Add a photo of the signed delivery note.' };
    }
    let collectionValue = null; // optional, collections only
    if (job.type === 'Collection' && isFeatureOn('collectionValue')) {
      collectionValue = parseCollectionValue(body.collectionValue);
      if (collectionValue === undefined) return { success: false, error: 'Enter the estimated value in rand, e.g. 850 — or leave it empty.' };
    }
    let proofUrl = '';
    try {
      proofUrl = saveJobProofImage(proof, job);
    } catch (err) {
      return { success: false, error: 'The photo could not be saved (' + err.message + '). Please try again.' };
    }
    cells.CompletedAt = now;
    cells.CompletedBy = actor.email;
    cells.ProofUrl = proofUrl;
    if (collectionValue !== null) cells.CollectionValue = collectionValue;
    cells.CompletionNotes = notes;
    historyNotes = 'Proof photo saved' + (collectionValue !== null ? ' · Estimated value: R ' + collectionValue.toFixed(2) : '') + (notes ? ' · ' + notes : '');
    messages.push([[creator].concat(getAdminEmails()), job.ref + ' was completed by ' + actor.name + '.']);
  } else if (key === 'fail') {
    const reason = String(body.reason || '');
    if (JOB_FAIL_REASONS.indexOf(reason) === -1) return { success: false, error: 'Choose what went wrong.' };
    if (reason === 'Other' && !notes) return { success: false, error: 'Please describe what went wrong.' };
    const summary = reason + (notes ? ' — ' + notes : '');
    cells.LastFailReason = summary;
    historyNotes = summary;
    const admins = getAdminEmails();
    messages.push([[creator].concat(admins), job.ref + ' could not be completed: ' + summary + '. It needs to be rescheduled or cancelled.']);
    failEmail = { to: admins.filter((e) => normEmail(e) !== actor.email), summary: summary };
  } else if (key === 'approve') {
    cells.ApprovedBy = actor.email;
    cells.ApprovedAt = now;
    if (isTransfer) {
      toStatus = 'Awaiting Dispatch';
      messages.push([[creator], job.ref + ' was approved.']);
      messages.push([branchManagers(job.branch), job.ref + ' was approved — please dispatch it to ' + job.receivingBranch + '.']);
    } else {
      toStatus = 'Approved';
      messages.push([[creator], job.ref + ' was approved.']);
    }
  } else if (key === 'dispatch') {
    const date = String(body.dispatchDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: 'Choose the dispatch date.' };
    const driverEmail = normEmail(body.driverEmail);
    let driver = null;
    if (driverEmail) {
      driver = approvedDrivers().filter((d) => d.email === driverEmail)[0];
      if (!driver) return { success: false, error: 'Choose a valid driver, or leave it on "No driver".' };
    }
    const items = readJobItems(job.ref);
    const sent = body.items || {};
    let total = 0;
    const updates = [];
    for (let i = 0; i < items.length; i++) {
      const q = wholeQty(sent[items[i].line]);
      if (q === null) return { success: false, error: 'Enter the quantity dispatched for item ' + items[i].line + ' (0 if none).' };
      total += q;
      updates.push([items[i].rowIndex, q]);
    }
    if (!total) return { success: false, error: 'Nothing is being dispatched — enter at least one quantity.' };
    const responsible = String(body.responsiblePerson || '').trim().slice(0, 120) || (driver ? driver.fullName : '');
    if (!responsible) return { success: false, error: 'Who is taking the items? Choose a driver or enter the responsible person.' };
    const itemSheet = jobItemsSheet();
    updates.forEach((u) => itemSheet.getRange(u[0], 6).setValue(u[1])); // QtyDispatched
    cells.DispatchDate = "'" + date;
    cells.DispatchedBy = actor.email;
    cells.ResponsiblePerson = responsible;
    cells.DriverEmail = driver ? driver.email : '';
    const short = items.filter((x, i) => updates[i][1] !== x.qtyRequested).length;
    historyNotes = total + ' item' + (total === 1 ? '' : 's') + ' dispatched on ' + date + ' with ' + responsible +
      (short ? ' · ' + short + (short === 1 ? ' line differs' : ' lines differ') + ' from the request' : '') + (notes ? ' · ' + notes : '');
    messages.push([branchManagers(job.receivingBranch), job.ref + ' is on its way from ' + job.branch + ' — please confirm what arrives.']);
    messages.push([[creator], job.ref + ' was dispatched (' + total + ' items).']);
    if (driver) {
      messages.push([[driver.email], 'You\'re taking transfer ' + job.ref + ' from ' + job.branch + ' to ' + job.receivingBranch + ' on ' + date + '.']);
      transferEmail = { to: [driver.email], subject: 'Transfer ' + job.ref + ' — ' + job.branch + ' → ' + job.receivingBranch + ' (' + date + ')',
        body: 'Hi ' + driver.fullName + ',\n\nYou\'re taking an inter-branch transfer.\n\n' +
          'Reference: ' + job.ref + '\nFrom: ' + job.branch + '\nTo: ' + job.receivingBranch + '\nDate: ' + date + '\n' +
          'Items:\n' + items.map((x, i) => '  • ' + updates[i][1] + ' × ' + x.description).join('\n') +
          '\n\nMark it delivered in the app once it\'s at ' + job.receivingBranch + ': ' + CONFIG.APP_URL + '#job=' + job.ref };
    }
  } else if (key === 'deliver') {
    messages.push([branchManagers(job.receivingBranch), job.ref + ' has been delivered to ' + job.receivingBranch + ' — please check it and confirm receipt.']);
  } else if (key === 'receive') {
    const items = readJobItems(job.ref);
    const got = body.items || {};
    const itemSheet = jobItemsSheet();
    const problems = [];
    const writes = [];
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      const g = got[x.line] || {};
      const q = wholeQty(g.qty);
      const condition = IBT_CONDITIONS.indexOf(g.condition) !== -1 ? g.condition : '';
      if (q === null) return { success: false, error: 'Enter the quantity received for item ' + x.line + ' (0 if none arrived).' };
      if (!condition && q > 0) return { success: false, error: 'Choose the condition of item ' + x.line + '.' };
      const sentQty = x.qtyDispatched === null ? x.qtyRequested : x.qtyDispatched;
      const issues = [];
      if (q < sentQty) issues.push((sentQty - q) + ' missing');
      if (q > sentQty) issues.push((q - sentQty) + ' extra');
      if (condition === 'Damaged') issues.push('damaged');
      const lineNote = String(g.notes || '').trim().slice(0, 300);
      if (issues.length) problems.push('Item ' + x.line + ' (' + x.description + '): ' + issues.join(', ') + (lineNote ? ' — ' + lineNote : ''));
      writes.push([x.rowIndex, [q, condition || (q === 0 ? '—' : ''), issues.join(', '), lineNote]]);
    }
    writes.forEach((w) => itemSheet.getRange(w[0], 7, 1, 4).setValues([w[1]])); // QtyReceived, Condition, Discrepancy, Notes
    cells.ReceivedAt = now;
    cells.ReceivedBy = actor.email;
    if (problems.length) {
      toStatus = 'Discrepancy Reported';
      historyNotes = problems.join(' | ') + (notes ? ' · ' + notes : '');
      const admins = getAdminEmails();
      messages.push([admins.concat(branchManagers(job.branch)), job.ref + ' arrived with a discrepancy (' + problems.length + ' line' +
        (problems.length === 1 ? '' : 's') + ') — Head Office needs to resolve it.']);
      transferEmail = { to: admins.filter((e) => normEmail(e) !== actor.email),
        subject: 'Discrepancy on transfer ' + job.ref + ' — ' + job.branch + ' → ' + job.receivingBranch,
        body: 'The receiving branch reported a discrepancy on an inter-branch transfer.\n\n' +
          'Reference: ' + job.ref + '\nFrom: ' + job.branch + '\nTo: ' + job.receivingBranch + '\nConfirmed by: ' + actor.name + '\n\n' +
          problems.map((p) => '  • ' + p).join('\n') + (notes ? '\n\nNote: ' + notes : '') +
          '\n\nResolve it in the app: ' + CONFIG.APP_URL + '#job=' + job.ref };
    } else {
      toStatus = 'Completed';
      cells.CompletedAt = now;
      cells.CompletedBy = actor.email;
      historyNotes = 'All items received in good condition' + (notes ? ' · ' + notes : '');
      messages.push([[creator].concat(branchManagers(job.branch)).concat(getAdminEmails()), job.ref + ' was received in full at ' + job.receivingBranch + '.']);
    }
  } else if (key === 'resolve') {
    cells.ResolutionNotes = notes;
    cells.CompletedAt = now;
    cells.CompletedBy = actor.email;
    historyNotes = 'Resolved: ' + notes;
    messages.push([[creator].concat(branchManagers(job.branch)).concat(branchManagers(job.receivingBranch)),
      'The discrepancy on ' + job.ref + ' was resolved: ' + notes]);
  } else if (key === 'schedule') {
    const driverEmail = normEmail(body.driverEmail);
    const date = String(body.scheduledDate || '').trim();
    const driver = approvedDrivers().filter((d) => d.email === driverEmail)[0];
    if (!driver) return { success: false, error: 'Choose a driver.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: 'Choose the scheduled date.' };
    const previousDriver = normEmail(job.driverEmail);
    cells.DriverEmail = driverEmail;
    cells.ScheduledDate = "'" + date;
    historyNotes = 'Driver: ' + driver.fullName + ' · Date: ' + date + (notes ? ' · ' + notes : '');
    if (previousDriver !== driverEmail) {
      messages.push([[driverEmail], 'You\'ve been assigned ' + job.ref + ' (' + job.type + ') for ' + date + '.']);
      if (previousDriver) messages.push([[previousDriver], job.ref + ' has been reassigned to another driver.']);
    } else {
      messages.push([[driverEmail], job.ref + ' has been rescheduled to ' + date + '.']);
    }
    messages.push([[creator], job.ref + ' is scheduled for ' + date + ' with ' + driver.fullName + '.']);
    if (previousDriver !== driverEmail) emailDriver = { email: driverEmail, name: driver.fullName, date: date };
  } else if (key === 'hold') {
    cells.HoldFromStatus = job.status;
    messages.push([parties, job.ref + ' is on hold: ' + notes]);
  } else if (key === 'resume') {
    toStatus = job.holdFromStatus || (isTransfer ? 'Awaiting Dispatch' : 'Approved');
    if (toStatus === 'Scheduled' && !job.driverEmail) toStatus = 'Approved';
    cells.HoldFromStatus = '';
    messages.push([parties, job.ref + ' is no longer on hold (' + toStatus + ').']);
  } else if (key === 'cancel') {
    const recipients = parties.slice();
    if (!isOfficeRole(actor.role)) getAdminEmails().forEach((e) => recipients.push(e));
    messages.push([recipients, job.ref + ' was cancelled: ' + notes]);
  }

  cells.Status = toStatus;
  setJobCells(found.rowIndex, cells);
  addJobHistory(job.ref, job.status, toStatus, actor.email, historyNotes);
  messages.forEach((m) => notifyUsers(m[0], job.ref, m[1], actor.email));

  let warning = '';
  if (emailDriver) {
    const d = emailDriver;
    warning = sendJobEmail([d.email], 'New ' + job.type.toLowerCase() + ' job ' + job.ref + ' — ' + d.date,
      'Hi ' + d.name + ',\n\nYou\'ve been assigned a ' + job.type.toLowerCase() + ' job.\n\n' +
      'Reference: ' + job.ref + '\n' +
      'Date: ' + d.date + '\n' +
      'Branch: ' + job.branch + '\n' +
      'Customer: ' + job.customerName + ' (' + job.customerContact + ')\n' +
      'Address: ' + job.address + '\n' +
      'Item: ' + job.itemCategory + ' — ' + job.itemDescription + '\n' +
      (job.instructions ? 'Instructions: ' + job.instructions + '\n' : '') +
      '\nOpen it in the app: ' + CONFIG.APP_URL + '#job=' + job.ref);
  }
  if (transferEmail) {
    warning = sendJobEmail(transferEmail.to, transferEmail.subject, transferEmail.body);
  }
  if (failEmail) {
    warning = sendJobEmail(failEmail.to, 'Failed ' + job.type.toLowerCase() + ' ' + job.ref + ' — ' + job.branch,
      'A ' + job.type.toLowerCase() + ' could not be completed and needs to be rescheduled or cancelled.\n\n' +
      'Reference: ' + job.ref + '\n' +
      'Branch: ' + job.branch + '\n' +
      'Customer: ' + job.customerName + '\n' +
      'Recorded by: ' + actor.name + '\n' +
      'What went wrong: ' + failEmail.summary + '\n\n' +
      'Open it in the app: ' + CONFIG.APP_URL + '#job=' + job.ref);
  }
  return { success: true, status: toStatus, warning: warning };
}

function saveJobProofImage(dataUrl, job) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl);
  const ext = m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg');
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'Proof_' + job.ref + '_' + stamp + '.' + ext);
  return getDriveFolder(['Vision CashUp Delivery Proof', String(job.branch || 'Unknown branch')]).createFile(blob).getUrl();
}

// ─────────────────────────────────────────────────────────────────────────
// DELIVERIES DASHBOARD, MONTHLY REPORT & MONDAY EMAIL (stage 4)
// One function works out every number; the app's dashboard, the printable
// monthly report and the Monday email all use it, so they always agree.
// ─────────────────────────────────────────────────────────────────────────

function toDateValue(v) {
  if (isDateValue(v)) return v;
  if (v === '' || v === null || v === undefined) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function jobDay(v) { const d = toDateValue(v); return d ? Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd') : ''; }
// Whole days between two yyyy-MM-dd strings (b − a).
function daysBetween(a, b) {
  const p = (s) => { const x = s.split('-'); return Date.UTC(Number(x[0]), Number(x[1]) - 1, Number(x[2])); };
  return Math.round((p(b) - p(a)) / 86400000);
}
function addDaysStr(s, n) {
  const x = s.split('-');
  const d = new Date(Date.UTC(Number(x[0]), Number(x[1]) - 1, Number(x[2]) + n));
  return d.toISOString().slice(0, 10);
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(s) { const x = s.split('-'); return Number(x[2]) + ' ' + MONTH_SHORT[Number(x[1]) - 1]; }

// scope: { branch: '' | name, type: '' | Delivery | Collection | Transfer, drivers: bool }
// range: { fromStr, toStr }
function buildDeliveriesDashboard(scope, range) {
  const today = todayString();
  const valueOn = isFeatureOn('collectionValue');
  const jobs = [];
  const byRef = {};
  jobsSheet().getDataRange().getValues().slice(1).forEach((r) => {
    if (!r[JC.Ref]) return;
    const j = jobFromRow(r);
    j.value = valueOn && j.type === 'Collection' && r[JC.CollectionValue] !== '' && r[JC.CollectionValue] !== null &&
      r[JC.CollectionValue] !== undefined && !isNaN(Number(r[JC.CollectionValue])) ? Number(r[JC.CollectionValue]) : null;
    byRef[j.ref] = j;
    if (scope.type && j.type !== scope.type) return;
    if (scope.branch && j.branch !== scope.branch && j.receivingBranch !== scope.branch) return;
    jobs.push(j);
  });
  const inRange = (d) => !!d && d >= range.fromStr && d <= range.toStr;
  const types = ALL_JOB_TYPES;
  const zero = () => { const o = {}; types.forEach((t) => { o[t] = 0; }); return o; };

  // History: failed attempts in the period.
  const hs = ss().getSheetByName(SHEETS.JOB_HISTORY);
  const hist = hs ? hs.getDataRange().getValues().slice(1) : [];
  const fails = [];
  hist.forEach((h) => {
    if (h[3] !== 'Failed Attempt') return;
    const j = byRef[String(h[1])];
    if (!j || jobs.indexOf(j) === -1) return;
    const day = jobDay(h[0]);
    if (!inRange(day)) return;
    const head = String(h[5] || '').split(' — ')[0];
    fails.push({ ref: j.ref, by: normEmail(h[4]), reason: JOB_FAIL_REASONS.indexOf(head) !== -1 ? head : 'Other' });
  });

  // Completed in the period.
  const done = jobs.filter((j) => j.status === 'Completed' && inRange(jobDay(j.completedAt)));
  const completed = zero();
  let onTimeOf = 0, onTime = 0, turnSum = 0, turnN = 0, value = 0, valued = 0;
  done.forEach((j) => {
    completed[j.type]++;
    const cd = jobDay(j.completedAt);
    if (j.requiredDate) { onTimeOf++; if (cd <= j.requiredDate) onTime++; }
    const cr = jobDay(j.createdAt);
    if (cr) { turnSum += Math.max(0, daysBetween(cr, cd)); turnN++; }
    if (j.value !== null && j.value !== undefined) { value += j.value; valued++; }
  });
  const open = jobs.filter((j) => JOB_FINAL_STATUSES.indexOf(j.status) === -1);
  const failedRefs = {};
  fails.forEach((f) => { failedRefs[f.ref] = true; });
  const recovered = Object.keys(failedRefs).filter((r) => byRef[r].status === 'Completed').length;

  // Trend: weeks (Monday start) for up to ~6 months, otherwise months.
  let from = range.fromStr;
  const earliest = jobs.reduce((m, j) => { const d = jobDay(j.createdAt); return d && (!m || d < m) ? d : m; }, '');
  if (earliest && earliest > from) from = earliest;
  if (from > range.toStr) from = range.toStr;
  const monthly = daysBetween(from, range.toStr) > 190;
  const bucketOf = (d) => {
    if (monthly) return d.slice(0, 7);
    const x = d.split('-');
    const dow = (new Date(Date.UTC(Number(x[0]), Number(x[1]) - 1, Number(x[2]))).getUTCDay() + 6) % 7; // Mon = 0
    return addDaysStr(d, -dow);
  };
  const keys = [];
  for (let k = bucketOf(from); k <= range.toStr.slice(0, monthly ? 7 : 10) && keys.length < 120;) {
    keys.push(k);
    if (monthly) { const y = Number(k.slice(0, 4)), m = Number(k.slice(5, 7)); k = (m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')); }
    else k = addDaysStr(k, 7);
  }
  const trend = { unit: monthly ? 'month' : 'week', labels: keys.map((k) => monthly ? MONTH_SHORT[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(2, 4) : shortDay(k)), series: {} };
  types.forEach((t) => { trend.series[t] = keys.map(() => 0); });
  done.forEach((j) => { const i = keys.indexOf(bucketOf(jobDay(j.completedAt))); if (i !== -1) trend.series[j.type][i]++; });

  // By branch (a transfer counts for the branch that sent it) and by category.
  const branchMap = {};
  done.forEach((j) => { const b = j.branch || '—'; (branchMap[b] = branchMap[b] || Object.assign({ branch: b }, zero()))[j.type]++; });
  const byBranch = Object.keys(branchMap).map((k) => branchMap[k]).sort((a, b) => a.branch.localeCompare(b.branch));
  const catMap = {};
  done.filter((j) => j.type !== 'Transfer').forEach((j) => {
    const c = j.itemCategory || 'Other';
    const o = catMap[c] = catMap[c] || { category: c, Delivery: 0, Collection: 0, value: 0 };
    o[j.type]++;
    if (j.value) o.value += j.value;
  });
  const byCategory = JOB_ITEM_CATEGORIES.concat(Object.keys(catMap).filter((c) => JOB_ITEM_CATEGORIES.indexOf(c) === -1))
    .filter((c) => catMap[c]).map((c) => catMap[c]);
  const reasonCount = {};
  fails.forEach((f) => { reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1; });
  const failReasons = JOB_FAIL_REASONS.filter((r) => reasonCount[r]).map((r) => ({ reason: r, count: reasonCount[r] }))
    .sort((a, b) => b.count - a.count);

  // Needs attention — what's wrong right now (not limited to the period).
  const attention = [];
  open.forEach((j) => {
    const issues = [];
    let severity = 9;
    let age = 0;
    if (j.overdue) { const d = daysBetween(j.requiredDate, today); issues.push('Overdue by ' + d + ' day' + (d === 1 ? '' : 's')); severity = 1; age = d; }
    if (j.status === 'Pending Approval') {
      const d = daysBetween(jobDay(j.createdAt) || today, today);
      if (d >= 1) { issues.push('Waiting ' + d + ' day' + (d === 1 ? '' : 's') + ' for approval'); severity = Math.min(severity, 2); age = Math.max(age, d); }
    }
    if (j.status === 'Failed Attempt') { issues.push('Failed — ' + (j.lastFailReason || 'needs rescheduling')); severity = Math.min(severity, 2); }
    if (j.status === 'Discrepancy Reported') { issues.push('Discrepancy to resolve'); severity = Math.min(severity, 2); }
    if (j.status === 'On Hold') { issues.push('On hold'); severity = Math.min(severity, 3); }
    if (!issues.length) return;
    attention.push({ ref: j.ref, type: j.type, status: j.status, branch: j.branch, receivingBranch: j.receivingBranch,
      requiredDate: j.requiredDate, issue: issues.join(' · '), severity: severity, age: age });
  });
  attention.sort((a, b) => a.severity - b.severity || b.age - a.age || a.ref.localeCompare(b.ref));

  // Transfer problems: open discrepancies, plus any received in the period with one.
  const is = ss().getSheetByName(SHEETS.JOB_ITEMS);
  const itemsByRef = {};
  (is ? is.getDataRange().getValues().slice(1) : []).forEach((it) => {
    if (it[8]) (itemsByRef[String(it[0])] = itemsByRef[String(it[0])] || []).push('Item ' + it[1] + ' (' + it[3] + '): ' + it[8]);
  });
  const transferProblems = jobs.filter((j) => j.type === 'Transfer' && itemsByRef[j.ref] &&
      (j.status === 'Discrepancy Reported' || inRange(jobDay(j.receivedAt))))
    .map((j) => ({ ref: j.ref, from: j.branch, to: j.receivingBranch, status: j.status, received: jobDay(j.receivedAt),
      problems: itemsByRef[j.ref], resolution: j.resolutionNotes }))
    .sort((a, b) => (a.status === 'Discrepancy Reported' ? 0 : 1) - (b.status === 'Discrepancy Reported' ? 0 : 1) || b.received.localeCompare(a.received));

  // Drivers — workload, not a ranking.
  let drivers = null;
  if (scope.drivers) {
    const map = {};
    const add = (email) => { const e = normEmail(email); if (!e) return null; return map[e] = map[e] || { email: e, name: userName(e), completed: 0, onTime: 0, timed: 0, failed: 0, open: 0 }; };
    approvedDrivers().forEach((d) => add(d.email));
    done.forEach((j) => { const d = add(j.driverEmail); if (!d) return; d.completed++; if (j.requiredDate) { d.timed++; if (jobDay(j.completedAt) <= j.requiredDate) d.onTime++; } });
    fails.forEach((f) => { const d = map[f.by]; if (d) d.failed++; });
    open.forEach((j) => { const d = add(j.driverEmail); if (d) d.open++; });
    drivers = Object.keys(map).map((k) => map[k]).map((d) => ({ name: d.name, email: d.email, completed: d.completed, failed: d.failed, open: d.open,
      onTimePct: d.timed ? Math.round(d.onTime / d.timed * 100) : null })).sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  }

  return {
    range: { from: range.fromStr, to: range.toStr },
    branch: scope.branch || '', type: scope.type || '',
    kpis: {
      completed: completed, completedTotal: done.length,
      requested: jobs.filter((j) => inRange(jobDay(j.createdAt))).length,
      onTimePct: onTimeOf ? Math.round(onTime / onTimeOf * 100) : null, onTime: onTime, onTimeOf: onTimeOf,
      open: open.length, overdue: open.filter((j) => j.overdue).length,
      failedAttempts: fails.length, failedJobs: Object.keys(failedRefs).length, recovered: recovered,
      avgDays: turnN ? Math.round(turnSum / turnN * 10) / 10 : null,
      collectionValue: valueOn ? Math.round(value * 100) / 100 : null, valuedCollections: valueOn ? valued : null
    },
    trend: trend, byBranch: byBranch, byCategory: byCategory, failReasons: failReasons,
    attention: attention.slice(0, 100), attentionTotal: attention.length,
    transferProblems: transferProblems.slice(0, 50),
    drivers: drivers,
    valueOn: valueOn
  };
}

function getDeliveriesDashboard(email, opts) {
  const actor = jobsActor(email);
  if (actor.role === 'Driver') return { success: false, error: 'The dashboard is for Head Office and store managers.' };
  const isManager = actor.role === 'Manager';
  const range = financeRange(opts || {});
  const type = ALL_JOB_TYPES.indexOf(String(opts.type || '')) !== -1 ? String(opts.type) : '';
  const branch = isManager ? actor.branch : String(opts.branch || '');
  const out = buildDeliveriesDashboard({ branch: branch, type: type, drivers: isOfficeRole(actor.role) }, range);
  out.success = true;
  out.role = actor.role;
  out.lockedBranch = isManager ? actor.branch : '';
  out.branches = isManager ? [] : getBranches();
  out.orgName = CONFIG.EXPORT_NAME || '';
  return out;
}

// A Store Manager of the job's branch, or Head Office, can add or correct the
// estimated value of a completed collection (the driver may not know it).
function setCollectionValue(body) {
  const actor = jobsActor(body.requesterEmail);
  if (!isFeatureOn('collectionValue')) return { success: false, error: 'Collection values are not switched on.' };
  const found = findJob(body.ref);
  if (!found || !canSeeJob(actor, found.job)) return { success: false, error: 'Job not found.' };
  const job = found.job;
  if (job.type !== 'Collection') return { success: false, error: 'Only collections have a value.' };
  if (!(isOfficeRole(actor.role) || (actor.role === 'Manager' && actor.branch === job.branch))) {
    return { success: false, error: 'You don\'t have permission to do that.' };
  }
  const v = parseCollectionValue(body.value);
  if (v === undefined) return { success: false, error: 'Enter the value in rand, e.g. 850 (or leave it empty).' };
  setJobCells(found.rowIndex, { CollectionValue: v === null ? '' : v, UpdatedAt: new Date(), UpdatedBy: actor.email });
  addJobHistory(job.ref, job.status, job.status, actor.email, v === null ? 'Estimated value removed' : 'Estimated value: R ' + v.toFixed(2));
  return { success: true, value: v };
}
// '' → null (no value); a valid amount → number; anything else → undefined.
function parseCollectionValue(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).replace(/[R\s,]/gi, '');
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n) || n < 0 || n > 10000000) return undefined;
  return Math.round(n * 100) / 100;
}

// ── Monday email ─────────────────────────────────────────────────────────
// Runs every Monday at about 07:00 once setUpWeeklyEmail() has been run from
// the Apps Script editor (one time). Goes to every approved Admin.

function lastWeekRange() {
  const today = todayString();
  const x = today.split('-');
  const dow = (new Date(Date.UTC(Number(x[0]), Number(x[1]) - 1, Number(x[2]))).getUTCDay() + 6) % 7; // Mon = 0
  const thisMonday = addDaysStr(today, -dow);
  return { fromStr: addDaysStr(thisMonday, -7), toStr: addDaysStr(thisMonday, -1) };
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

function weeklyEmailContent() {
  const range = lastWeekRange();
  const d = buildDeliveriesDashboard({ branch: '', type: '', drivers: false }, range);
  const k = d.kpis;
  const title = 'Deliveries — week of ' + shortDay(range.fromStr) + ' to ' + shortDay(range.toStr);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rand = (n) => 'R ' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const lines = [
    ['Completed', k.completedTotal + ' (' + plural(k.completed.Delivery, 'delivery', 'deliveries') + ', ' + plural(k.completed.Collection, 'collection') + ', ' + plural(k.completed.Transfer, 'transfer') + ')'],
    ['On time', k.onTimePct === null ? '—' : k.onTimePct + '% (' + k.onTime + ' of ' + k.onTimeOf + ')'],
    ['New requests', String(k.requested)],
    ['Failed attempts', k.failedAttempts + (k.failedAttempts ? ' (' + k.recovered + ' since completed)' : '')],
    ['Average turnaround', k.avgDays === null ? '—' : k.avgDays + ' days'],
    ['Open now', k.open + (k.overdue ? ' — ' + k.overdue + ' overdue' : '')]
  ];
  if (d.valueOn) lines.push(['Donated stock collected', rand(k.collectionValue) + (k.valuedCollections ? ' (' + k.valuedCollections + ' valued)' : '')]);
  const att = d.attention.slice(0, 15);
  const link = (ref) => CONFIG.APP_URL + '#job=' + ref;

  const text = title + '\n\n' + lines.map((l) => l[0] + ': ' + l[1]).join('\n') +
    (d.byBranch.length ? '\n\nBy branch:\n' + d.byBranch.map((b) => '  ' + b.branch + ': ' + plural(b.Delivery, 'delivery', 'deliveries') + ', ' + plural(b.Collection, 'collection') + ', ' + plural(b.Transfer, 'transfer')).join('\n') : '') +
    '\n\nNeeds attention (' + d.attentionTotal + '):\n' + (att.length ? att.map((a) => '  ' + a.ref + ' · ' + a.branch + ' · ' + a.issue).join('\n') : '  Nothing — all on track.') +
    (d.attentionTotal > att.length ? '\n  …and ' + (d.attentionTotal - att.length) + ' more in the app.' : '') +
    (d.transferProblems.length ? '\n\nTransfer discrepancies:\n' + d.transferProblems.slice(0, 10).map((t) => '  ' + t.ref + ' ' + t.from + ' → ' + t.to + ' (' + t.status + ')').join('\n') : '') +
    '\n\nOpen the dashboard: ' + CONFIG.APP_URL;

  const cell = 'padding:6px 10px;border-bottom:1px solid #e3e8ef;';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1d2a3a;max-width:640px;">' +
    '<h2 style="color:#0b4ea2;margin:0 0 4px;">' + esc(title) + '</h2>' +
    '<p style="color:#6b7787;margin:0 0 14px;">All branches · weekly summary from Vision Cash-Up</p>' +
    '<table style="border-collapse:collapse;width:100%;margin-bottom:16px;">' +
      lines.map((l) => '<tr><td style="' + cell + 'color:#6b7787;width:45%;">' + esc(l[0]) + '</td><td style="' + cell + 'font-weight:bold;">' + esc(l[1]) + '</td></tr>').join('') +
    '</table>' +
    (d.byBranch.length ? '<h3 style="margin:0 0 6px;">By branch</h3><table style="border-collapse:collapse;width:100%;margin-bottom:16px;">' +
      '<tr><th align="left" style="' + cell + '">Branch</th><th style="' + cell + '">Deliveries</th><th style="' + cell + '">Collections</th><th style="' + cell + '">Transfers</th></tr>' +
      d.byBranch.map((b) => '<tr><td style="' + cell + '">' + esc(b.branch) + '</td><td align="center" style="' + cell + '">' + b.Delivery + '</td><td align="center" style="' + cell + '">' + b.Collection + '</td><td align="center" style="' + cell + '">' + b.Transfer + '</td></tr>').join('') +
      '</table>' : '') +
    '<h3 style="margin:0 0 6px;">Needs attention (' + d.attentionTotal + ')</h3>' +
    (att.length ? '<table style="border-collapse:collapse;width:100%;margin-bottom:16px;">' + att.map((a) =>
      '<tr><td style="' + cell + '"><a href="' + esc(link(a.ref)) + '" style="color:#0b4ea2;font-weight:bold;">' + esc(a.ref) + '</a></td>' +
      '<td style="' + cell + '">' + esc(a.branch) + (a.receivingBranch ? ' → ' + esc(a.receivingBranch) : '') + '</td>' +
      '<td style="' + cell + (a.severity === 1 ? 'color:#c62828;font-weight:bold;' : '') + '">' + esc(a.issue) + '</td></tr>').join('') + '</table>' +
      (d.attentionTotal > att.length ? '<p style="color:#6b7787;">…and ' + (d.attentionTotal - att.length) + ' more in the app.</p>' : '')
      : '<p style="color:#2e7d32;">Nothing — all on track.</p>') +
    (d.transferProblems.length ? '<h3 style="margin:0 0 6px;">Transfer discrepancies</h3><ul>' + d.transferProblems.slice(0, 10).map((t) =>
      '<li><a href="' + esc(link(t.ref)) + '" style="color:#0b4ea2;">' + esc(t.ref) + '</a> ' + esc(t.from) + ' → ' + esc(t.to) + ' — ' + esc(t.status) + '</li>').join('') + '</ul>' : '') +
    '<p style="margin-top:18px;"><a href="' + esc(CONFIG.APP_URL) + '" style="background:#0b4ea2;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;">Open the dashboard</a></p>' +
    '<p style="color:#9aa4b2;font-size:12px;margin-top:18px;">You get this every Monday because you\'re an Admin on Vision Cash-Up.</p></div>';
  return { subject: title, text: text, html: html };
}

// The time trigger calls this. Safe to run by hand from the editor too.
function sendWeeklyDeliveriesEmail() {
  SETTINGS_MEMO = null;
  if (!isFeatureOn('deliveries') || !isFeatureOn('weeklyEmail')) return 'Switched off — nothing sent.';
  const to = getAdminEmails().map(normEmail).filter((e) => e);
  if (!to.length) return 'No Admins to send to.';
  const c = weeklyEmailContent();
  return sendJobEmail(to, c.subject, c.text, c.html) || ('Sent to ' + to.length + ' Admin' + (to.length === 1 ? '' : 's') + '.');
}

// Developer tab → "Send me a preview": the same email, only to the developer.
function sendWeeklyEmailPreview(body) {
  const me = requireDeveloper(body.requesterEmail);
  if (!isFeatureOn('deliveries')) return { success: false, error: 'Switch on Delivery / Collection Service first.' };
  const c = weeklyEmailContent();
  const warning = sendJobEmail([normEmail(me.row[3])], '[Preview] ' + c.subject, c.text, c.html);
  return warning ? { success: false, error: warning } : { success: true };
}

// Run ONCE from the Apps Script editor (choose it in the function list and
// press Run). Safe to run again — it never creates a second schedule.
function setUpWeeklyEmail() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'sendWeeklyDeliveriesEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyDeliveriesEmail').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone(CONFIG.TIMEZONE).create();
  return 'Monday email scheduled for about 07:00 every Monday.';
}

function weeklyEmailScheduled() {
  try {
    return ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'sendWeeklyDeliveriesEmail');
  } catch (err) {
    return null; // not known (the script hasn't been given permission yet)
  }
}

// ── In-app notifications (the bell) ──────────────────────────────────────

function notifyUsers(recipients, ref, message, exceptEmail) {
  const seen = {};
  const rows = [];
  const now = new Date();
  (recipients || []).forEach((r) => {
    const e = normEmail(r);
    if (!e || seen[e] || e === normEmail(exceptEmail)) return;
    seen[e] = true;
    rows.push([Utilities.getUuid().slice(0, 8), now, e, ref, message, '']);
  });
  if (!rows.length) return;
  const s = getOrCreateSheet(SHEETS.NOTIFICATIONS, NOTIFICATION_HEADERS);
  s.getRange(s.getLastRow() + 1, 1, rows.length, NOTIFICATION_HEADERS.length).setValues(rows);
}

function getNotifications(email) {
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved') return { success: false, error: 'Not authorized.' };
  if (!isFeatureOn('deliveries')) return { success: true, unread: 0, items: [] };
  const s = ss().getSheetByName(SHEETS.NOTIFICATIONS);
  if (!s) return { success: true, unread: 0, items: [] };
  const me = normEmail(found.row[3]);
  const data = s.getDataRange().getValues();
  const items = [];
  let unread = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (normEmail(data[i][2]) !== me) continue;
    const isUnread = !data[i][5];
    if (isUnread) unread++;
    if (items.length < 25) items.push({ id: data[i][0], timestamp: data[i][1], ref: data[i][3], message: data[i][4], unread: isUnread });
  }
  return { success: true, unread: unread, items: items };
}

function markNotificationsRead(body) {
  const found = authUser(body.requesterEmail);
  if (!found || found.row[5] !== 'Approved') return { success: false, error: 'Not authorized.' };
  const s = ss().getSheetByName(SHEETS.NOTIFICATIONS);
  if (!s) return { success: true };
  const me = normEmail(found.row[3]);
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
  const ref = body.ref ? String(body.ref) : '';
  const data = s.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    if (normEmail(data[i][2]) !== me || data[i][5]) continue;
    if (body.all || (ids && ids.indexOf(String(data[i][0])) !== -1) || (ref && String(data[i][3]) === ref)) {
      s.getRange(i + 1, 6).setValue(now);
    }
  }
  return { success: true };
}

// Email within Gmail's daily limit (about 100 recipients a day on a normal
// Gmail account). If the limit is reached or sending fails, the job is
// already saved — the in-app notification still goes out — and the app is
// told so it can show a note. Returns a warning string or ''.
function sendJobEmail(to, subject, body, htmlBody) {
  const recipients = (to || []).filter((e) => !!e);
  if (!recipients.length) return '';
  try {
    if (MailApp.getRemainingDailyQuota() < recipients.length) {
      return 'Saved, but today\'s email limit has been reached — the in-app notification was still sent.';
    }
    const msg = { to: recipients.join(','), subject: subject, body: body };
    if (htmlBody) msg.htmlBody = htmlBody;
    MailApp.sendEmail(msg);
    return '';
  } catch (err) {
    return 'Saved, but the email could not be sent (' + err.message + ').';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FINANCE — Head Office expenses & income, and the shared category list
// (Pro feature "hoExpenses"; branch Shop Expenses use the same categories)
//
// Two levels: MAJOR categories are fixed in code (below) so dashboards work
// the same for every organisation; each organisation adds its own
// SUBCATEGORIES under them (Admins only). Subcategories are never deleted —
// only hidden — so past entries keep their meaning. A major can be hidden if
// an organisation doesn't use it.
//
// Sheets (created automatically):
//   FinanceCategories  SubID | Kind | MajorKey | Name | Active | Sort | UpdatedBy | UpdatedAt
//   Finance            one row per Head Office expense or income entry
//   FinanceRecurring   repeat-monthly templates (rent, wages, debit orders…)
//
// The overview combines: Head Office entries + branch Shop Expenses + shop
// sales and in-store donations from the cash-ups (donations are part of the
// Z-reading, so they're split out of sales rather than added on top), for
// any period and for Head Office, one branch, or everything.
// ─────────────────────────────────────────────────────────────────────────

const FIN_MAJORS = [
  // Expenses
  { key: 'premises', kind: 'Expense', name: 'Premises & Utilities' },
  { key: 'staff', kind: 'Expense', name: 'Staff' },
  { key: 'comms', kind: 'Expense', name: 'Communications' },
  { key: 'it', kind: 'Expense', name: 'IT & Software' },
  { key: 'marketing', kind: 'Expense', name: 'Marketing' },
  { key: 'office', kind: 'Expense', name: 'Office & Admin' },
  { key: 'vehicles', kind: 'Expense', name: 'Vehicles & Transport' },
  { key: 'fees', kind: 'Expense', name: 'Bank & Professional Fees' },
  { key: 'insurance', kind: 'Expense', name: 'Insurance' },
  { key: 'supplies', kind: 'Expense', name: 'Shop Supplies' },
  { key: 'programme', kind: 'Expense', name: 'Charitable Programme' },
  { key: 'other', kind: 'Expense', name: 'Other Expenses' },
  // Income
  { key: 'shopsales', kind: 'Income', name: 'Shop Sales', auto: true }, // from cash-ups, one subcategory per branch
  { key: 'donations', kind: 'Income', name: 'Donations' },
  { key: 'grants', kind: 'Income', name: 'Grants & Funding' },
  { key: 'advertising', kind: 'Income', name: 'Advertising & Sponsorship' },
  { key: 'recycling', kind: 'Income', name: 'Recycling & Bulk Sales' },
  { key: 'rentalincome', kind: 'Income', name: 'Rental Income' },
  { key: 'services', kind: 'Income', name: 'Service Fees' },
  { key: 'otherincome', kind: 'Income', name: 'Other Income' }
];
const FIN_DEFAULT_SUBS = {
  premises: [['rent', 'Property rental'], ['electricity', 'Electricity'], ['water', 'Water & municipal'], ['security', 'Security & alarm'], ['cleaning', 'Cleaning'], ['repairs', 'Repairs & maintenance']],
  staff: [['wages', 'Wages & salaries'], ['commission', 'Agents\' commission'], ['casual', 'Casual staff'], ['refreshments', 'Staff refreshments'], ['training', 'Training']],
  comms: [['telephone', 'Telephone'], ['cell', 'Cell phones & data'], ['internet', 'Internet']],
  it: [['support', 'IT support'], ['hardware', 'Computer hardware'], ['software', 'Software & licences'], ['website', 'Website & hosting']],
  marketing: [['media', 'Media advertising'], ['promotions', 'Promotions & events'], ['signage', 'Signage'], ['printing', 'Printing & flyers']],
  office: [['stationery', 'Stationery'], ['equipment', 'Office equipment & furniture'], ['groceries', 'Groceries & kitchen'], ['postage', 'Postage & courier']],
  vehicles: [['fuel', 'Fuel'], ['carrental', 'Car rental'], ['maintenance', 'Vehicle maintenance'], ['licensing', 'Vehicle licensing'], ['tolls', 'Tolls & parking']],
  fees: [['bank', 'Bank charges'], ['card', 'Card machine fees'], ['accounting', 'Accounting fees'], ['legal', 'Legal fees']],
  insurance: [['building', 'Building & contents'], ['vehicle', 'Vehicle'], ['liability', 'Liability']],
  supplies: [['bags', 'Bags & packaging'], ['tags', 'Price tags & labels'], ['fittings', 'Hangers & shop fittings']],
  programme: [['transfers', 'Funds to the charity / programme']],
  other: [['sundry', 'Sundry']],
  donations: [['individual', 'Individual'], ['corporate', 'Corporate'], ['debit', 'Monthly debit-order donors'], ['online', 'Online donations'], ['events', 'Fundraising events']],
  grants: [['lottery', 'Lottery (NLC)'], ['trusts', 'Trusts & foundations'], ['csi', 'Corporate CSI'], ['government', 'Government']],
  advertising: [['space', 'Advertising space'], ['sponsorship', 'Event sponsorship']],
  recycling: [['textiles', 'Textile recycling'], ['scrap', 'Scrap metal'], ['bulk', 'Bulk sales to traders']],
  rentalincome: [['space', 'Sub-let space'], ['equipment', 'Equipment hire']],
  services: [['delivery', 'Delivery charges']],
  otherincome: [['interest', 'Bank interest'], ['refunds', 'Refunds'], ['sundry', 'Other']]
};
// Filled in automatically from the cash-ups — can't be captured by hand.
const FIN_AUTO_SUBS = { 'donations.instore': { majorKey: 'donations', name: 'In-store donations (cash-ups)' } };
// Branch Shop Expenses captured before the shared list existed.
const LEGACY_SHOP_TYPES = {
  'Electricity': 'premises.electricity', 'Repairs (Technical fees)': 'premises.repairs', 'Rental': 'premises.rent',
  'Utility (Water, etc)': 'premises.water', 'Other': 'other.sundry'
};
const FIN_HEADERS = ['ID', 'Kind', 'Date', 'MajorKey', 'Major', 'SubID', 'Subcategory', 'Amount', 'Description', 'Party',
  'Method', 'Reference', 'ForBranch', 'ReceiptUrl', 'CapturedBy', 'CapturedAt', 'RecurringID', 'RecurringMonth',
  'Status', 'UpdatedBy', 'UpdatedAt', 'ClientRequestId'];
const FC = {}; FIN_HEADERS.forEach((h, i) => { FC[h] = i; });
const FIN_REC_HEADERS = ['ID', 'Kind', 'MajorKey', 'SubID', 'Amount', 'Description', 'Party', 'Method', 'ForBranch',
  'DayOfMonth', 'StartMonth', 'Active', 'CreatedBy', 'CreatedAt', 'StoppedBy', 'StoppedAt'];
const FR = {}; FIN_REC_HEADERS.forEach((h, i) => { FR[h] = i; });
const FIN_CAT_HEADERS = ['SubID', 'Kind', 'MajorKey', 'Name', 'Active', 'Sort', 'UpdatedBy', 'UpdatedAt'];
const FIN_METHODS = ['EFT', 'Debit order', 'Card', 'Cash', 'Other'];
const HEAD_OFFICE = 'Head Office';
const FIN_MAX_AMOUNT = 100000000;

function finMajor(key) { return FIN_MAJORS.filter((m) => m.key === key)[0] || null; }
function finText(v) { return String(v === undefined || v === null ? '' : v); }

// Fills in any missing header cells (so sheets made by older versions keep working).
function ensureSheetHeaders(s, headers) {
  const head = s.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => { if (!head[i]) s.getRange(1, i + 1).setValue(h).setFontWeight('bold'); });
  return s;
}

function finCategorySheet() {
  const s = getOrCreateSheet(SHEETS.FIN_CATEGORIES, FIN_CAT_HEADERS);
  if (s.getLastRow() < 2) {
    const now = new Date();
    const rows = [];
    FIN_MAJORS.forEach((m) => (FIN_DEFAULT_SUBS[m.key] || []).forEach((sub, i) =>
      rows.push([m.key + '.' + sub[0], m.kind, m.key, sub[1], true, i + 1, 'default', now])));
    s.getRange(2, 1, rows.length, FIN_CAT_HEADERS.length).setValues(rows);
  }
  return s;
}

let FIN_CATS_MEMO = null;
// Returns { majors: [...with subs], subsById: {id: sub} }.
function finCategories() {
  if (FIN_CATS_MEMO) return FIN_CATS_MEMO;
  const data = finCategorySheet().getDataRange().getValues();
  const hidden = String(readSettings()['Finance.HiddenMajors'] || '').split(',').filter(Boolean);
  const subsById = {};
  const byMajor = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || !finMajor(r[2])) continue;
    const sub = { id: String(r[0]), kind: r[1], majorKey: r[2], name: finText(r[3]), active: r[4] === true || String(r[4]).toUpperCase() === 'TRUE', sort: Number(r[5]) || 0, rowIndex: i + 1 };
    subsById[sub.id] = sub;
    (byMajor[sub.majorKey] = byMajor[sub.majorKey] || []).push(sub);
  }
  Object.keys(FIN_AUTO_SUBS).forEach((id) => {
    const a = FIN_AUTO_SUBS[id];
    subsById[id] = { id: id, kind: 'Income', majorKey: a.majorKey, name: a.name, active: true, auto: true, sort: 999 };
  });
  const majors = FIN_MAJORS.map((m) => ({
    key: m.key, kind: m.kind, name: m.name, auto: !!m.auto, hidden: hidden.indexOf(m.key) !== -1,
    subs: (byMajor[m.key] || []).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map((s) => ({ id: s.id, name: s.name, active: s.active }))
  }));
  FIN_CATS_MEMO = { majors: majors, subsById: subsById, hidden: hidden };
  return FIN_CATS_MEMO;
}

// Who may do what with finance.
function financeActor(email, need) {
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved') throw new Error('Not authorized.');
  const role = found.row[6];
  const actor = { email: normEmail(found.row[3]), name: found.row[1], role: role, branch: found.row[7] };
  const office = role === 'Admin' || role === 'Developer';
  if (need === 'categories-read') {
    // Store Managers read the expense list for their Shop Expenses tab.
    if (role === 'Manager' && isFeatureOn('shopExpenses')) return actor;
    if ((office || role === 'BackOffice') && (isFeatureOn('hoExpenses') || isFeatureOn('shopExpenses'))) return actor;
    throw new Error('Not authorized.');
  }
  if (!isFeatureOn('hoExpenses')) throw new Error('Head Office Finance is not switched on.');
  if (need === 'manage-categories' && !office) throw new Error('Only Admins can change categories.');
  if (!office && role !== 'BackOffice') throw new Error('Not authorized.');
  return actor;
}

function getFinanceSetup(email) {
  const actor = financeActor(email, 'categories-read');
  const cats = finCategories();
  const office = actor.role === 'Admin' || actor.role === 'Developer';
  const full = office || actor.role === 'BackOffice';
  const majors = cats.majors
    .filter((m) => full || (m.kind === 'Expense' && !m.hidden))
    .map((m) => ({ key: m.key, kind: m.kind, name: m.name, auto: m.auto, hidden: m.hidden,
      subs: m.subs.filter((s) => full || s.active) }));
  return {
    success: true,
    majors: majors,
    branches: getBranches(),
    headOffice: HEAD_OFFICE,
    methods: FIN_METHODS,
    canManage: office && isFeatureOn('hoExpenses'),
    canCapture: full && isFeatureOn('hoExpenses')
  };
}

function financeCategoryAction(body) {
  const actor = financeActor(body.requesterEmail, 'manage-categories');
  const s = finCategorySheet();
  const cats = finCategories();
  const now = new Date();
  const op = String(body.op || '');
  if (op === 'add') {
    const major = finMajor(body.majorKey);
    const name = String(body.name || '').trim().slice(0, 60);
    if (!major || major.auto) return { success: false, error: 'Choose a category.' };
    if (!name) return { success: false, error: 'Enter a name for the subcategory.' };
    const existing = (cats.majors.filter((m) => m.key === major.key)[0] || { subs: [] }).subs;
    if (existing.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { success: false, error: '"' + name + '" already exists under ' + major.name + '.' };
    s.appendRow(['u-' + Utilities.getUuid().slice(0, 8), major.kind, major.key, name, true, existing.length + 1, actor.email, now]);
  } else if (op === 'rename' || op === 'toggle') {
    const sub = cats.subsById[String(body.subId || '')];
    if (!sub || sub.auto) return { success: false, error: 'Subcategory not found.' };
    if (op === 'rename') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return { success: false, error: 'Enter a name.' };
      const siblings = cats.majors.filter((m) => m.key === sub.majorKey)[0].subs;
      if (siblings.some((x) => x.id !== sub.id && x.name.toLowerCase() === name.toLowerCase())) return { success: false, error: '"' + name + '" already exists.' };
      s.getRange(sub.rowIndex, 4).setValue(name);
    } else {
      s.getRange(sub.rowIndex, 5).setValue(!sub.active);
    }
    s.getRange(sub.rowIndex, 7, 1, 2).setValues([[actor.email, now]]);
  } else if (op === 'toggleMajor') {
    const major = finMajor(body.majorKey);
    if (!major) return { success: false, error: 'Category not found.' };
    const hidden = cats.hidden.slice();
    const i = hidden.indexOf(major.key);
    if (i === -1) hidden.push(major.key); else hidden.splice(i, 1);
    const ss2 = settingsSheet();
    const data = ss2.getDataRange().getValues();
    let row = 0;
    for (let r = 1; r < data.length; r++) if (data[r][0] === 'Finance.HiddenMajors') row = r + 1;
    if (row) ss2.getRange(row, 2, 1, 3).setValues([[hidden.join(','), actor.email, now]]);
    else ss2.appendRow(['Finance.HiddenMajors', hidden.join(','), actor.email, now]);
    SETTINGS_MEMO = null;
  } else {
    return { success: false, error: 'Unknown change.' };
  }
  FIN_CATS_MEMO = null;
  return { success: true };
}

function finSheet() { return ensureSheetHeaders(getOrCreateSheet(SHEETS.FINANCE, FIN_HEADERS), FIN_HEADERS); }
function finRecSheet() { return getOrCreateSheet(SHEETS.FIN_RECURRING, FIN_REC_HEADERS); }

function nextFinId(s, prefix, col) {
  const data = s.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(String(data[i][col]));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + '-' + String(max + 1).padStart(5, '0');
}

// Validates an entry from the app. Returns { entry } or { error }.
function cleanFinanceEntry(body) {
  const kind = body.kind === 'Income' ? 'Income' : (body.kind === 'Expense' ? 'Expense' : '');
  if (!kind) return { error: 'Choose expense or income.' };
  const cats = finCategories();
  const sub = cats.subsById[String(body.subId || '')];
  if (!sub || sub.auto || sub.kind !== kind) return { error: 'Choose a category and subcategory.' };
  const major = finMajor(sub.majorKey);
  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose the date.' };
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  if (!(amount > 0) || amount > FIN_MAX_AMOUNT) return { error: 'Enter an amount greater than zero.' };
  const description = String(body.description || '').trim().slice(0, 300);
  if (!description) return { error: 'Add a short description.' };
  const forBranch = String(body.forBranch || HEAD_OFFICE);
  if (forBranch !== HEAD_OFFICE && getBranches().indexOf(forBranch) === -1) return { error: 'Choose Head Office or a branch.' };
  const method = FIN_METHODS.indexOf(body.method) !== -1 ? body.method : '';
  return { entry: {
    kind: kind, date: date, majorKey: major.key, major: major.name, subId: sub.id, sub: sub.name, amount: amount,
    description: description, party: String(body.party || '').trim().slice(0, 120), method: method,
    reference: String(body.reference || '').trim().slice(0, 60), forBranch: forBranch
  } };
}

function saveFinanceReceipt(dataUrl, id) {
  const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return '';
  if (m[2].length > 7000000) throw new Error('The receipt file is too large (max about 5 MB).');
  const ext = m[1] === 'application/pdf' ? 'pdf' : (m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg'));
  const month = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'Receipt_' + id + '.' + ext);
  return getDriveFolder(['Vision CashUp Finance', month]).createFile(blob).getUrl();
}

function finEntryFromRow(r, rowIndex) {
  return {
    rowIndex: rowIndex, id: finText(r[FC.ID]), kind: finText(r[FC.Kind]), date: dayString(r[FC.Date]),
    majorKey: finText(r[FC.MajorKey]), major: finText(r[FC.Major]), subId: finText(r[FC.SubID]), sub: finText(r[FC.Subcategory]),
    amount: Number(r[FC.Amount]) || 0, description: finText(r[FC.Description]), party: finText(r[FC.Party]),
    method: finText(r[FC.Method]), reference: finText(r[FC.Reference]), forBranch: finText(r[FC.ForBranch]) || HEAD_OFFICE,
    receiptUrl: finText(r[FC.ReceiptUrl]), capturedBy: finText(r[FC.CapturedBy]), capturedAt: r[FC.CapturedAt] || '',
    recurringId: finText(r[FC.RecurringID]), recurringMonth: dayString(r[FC.RecurringMonth]).slice(0, 7),
    status: finText(r[FC.Status]) || 'Active', updatedBy: finText(r[FC.UpdatedBy]), updatedAt: r[FC.UpdatedAt] || '',
    clientRequestId: finText(r[FC.ClientRequestId])
  };
}

function readFinanceEntries() {
  const s = ss().getSheetByName(SHEETS.FINANCE);
  if (!s) return [];
  const data = s.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) if (data[i][FC.ID]) out.push(finEntryFromRow(data[i], i + 1));
  return out;
}

function writeFinanceEntry(e, actor, extra) {
  const s = finSheet();
  const now = new Date();
  const id = nextFinId(s, 'FIN', FC.ID);
  const row = FIN_HEADERS.map(() => '');
  row[FC.ID] = id; row[FC.Kind] = e.kind; row[FC.Date] = "'" + e.date; row[FC.MajorKey] = e.majorKey; row[FC.Major] = e.major;
  row[FC.SubID] = e.subId; row[FC.Subcategory] = e.sub; row[FC.Amount] = e.amount; row[FC.Description] = e.description;
  row[FC.Party] = e.party; row[FC.Method] = e.method; row[FC.Reference] = e.reference ? "'" + e.reference : '';
  row[FC.ForBranch] = e.forBranch; row[FC.CapturedBy] = actor.email; row[FC.CapturedAt] = now; row[FC.Status] = 'Active';
  row[FC.UpdatedBy] = actor.email; row[FC.UpdatedAt] = now;
  Object.keys(extra || {}).forEach((k) => { row[FC[k]] = extra[k]; });
  s.appendRow(row);
  return id;
}

// Create or edit an entry. With repeatMonthly, also sets up a monthly template
// (this entry counts as the first month's).
function saveFinanceEntry(body) {
  const actor = financeActor(body.requesterEmail, 'capture');
  const cleaned = cleanFinanceEntry(body);
  if (cleaned.error) return { success: false, error: cleaned.error };
  const e = cleaned.entry;
  const requestId = String(body.clientRequestId || '');

  if (body.id) {
    const existing = readFinanceEntries().filter((x) => x.id === String(body.id) && x.status === 'Active')[0];
    if (!existing) return { success: false, error: 'Entry not found.' };
    const s = finSheet();
    let receiptUrl = existing.receiptUrl;
    if (body.receipt) receiptUrl = saveFinanceReceipt(body.receipt, existing.id) || receiptUrl;
    if (body.removeReceipt) receiptUrl = '';
    const vals = { Kind: e.kind, Date: "'" + e.date, MajorKey: e.majorKey, Major: e.major, SubID: e.subId, Subcategory: e.sub,
      Amount: e.amount, Description: e.description, Party: e.party, Method: e.method, Reference: e.reference ? "'" + e.reference : '',
      ForBranch: e.forBranch, ReceiptUrl: receiptUrl, UpdatedBy: actor.email, UpdatedAt: new Date() };
    Object.keys(vals).forEach((h) => s.getRange(existing.rowIndex, FC[h] + 1).setValue(vals[h]));
    return { success: true, id: existing.id };
  }

  if (requestId) {
    const dup = readFinanceEntries().filter((x) => x.clientRequestId === requestId)[0];
    if (dup) return { success: true, id: dup.id, duplicate: true };
  }
  const extra = { ClientRequestId: requestId };
  let recurringId = '';
  if (body.dueRecurringId) {
    // Recording a repeat-monthly item from the Due tab (with any changes and a receipt).
    const dueMonth = String(body.dueMonth || '');
    if (!finDueItems().some((d) => d.recurringId === String(body.dueRecurringId) && d.month === dueMonth)) {
      return { success: false, error: 'That month has already been recorded or skipped. Refresh the Due tab.' };
    }
    extra.RecurringID = String(body.dueRecurringId);
    extra.RecurringMonth = "'" + dueMonth;
  } else if (body.repeatMonthly) {
    const day = Math.min(28, Math.max(1, Number(body.dayOfMonth) || Number(e.date.slice(8, 10)) || 1));
    const rs = finRecSheet();
    recurringId = nextFinId(rs, 'REC', FR.ID);
    rs.appendRow([recurringId, e.kind, e.majorKey, e.subId, e.amount, e.description, e.party, e.method, e.forBranch,
      day, "'" + e.date.slice(0, 7), true, actor.email, new Date(), '', '']);
    extra.RecurringID = recurringId;
    extra.RecurringMonth = "'" + e.date.slice(0, 7);
  }
  let warning = '';
  const id = writeFinanceEntry(e, actor, extra);
  if (body.receipt) {
    try {
      const url = saveFinanceReceipt(body.receipt, id);
      const s = finSheet();
      const row = readFinanceEntries().filter((x) => x.id === id)[0];
      if (url && row) s.getRange(row.rowIndex, FC.ReceiptUrl + 1).setValue(url);
    } catch (err) { warning = 'Saved, but the receipt could not be uploaded (' + err.message + ').'; }
  }
  return { success: true, id: id, recurringId: recurringId, warning: warning };
}

function deleteFinanceEntry(body) {
  const actor = financeActor(body.requesterEmail, 'capture');
  const reason = String(body.reason || '').trim();
  if (!reason) return { success: false, error: 'Please give a reason for deleting it.' };
  const e = readFinanceEntries().filter((x) => x.id === String(body.id) && x.status === 'Active')[0];
  if (!e) return { success: false, error: 'Entry not found.' };
  const s = finSheet();
  // Kept in the sheet for the record, just excluded from totals.
  s.getRange(e.rowIndex, FC.Status + 1).setValue('Deleted: ' + reason.slice(0, 200));
  s.getRange(e.rowIndex, FC.UpdatedBy + 1, 1, 2).setValues([[actor.email, new Date()]]);
  return { success: true };
}

// ── Repeat-monthly ───────────────────────────────────────────────────────

function readRecurring() {
  const s = ss().getSheetByName(SHEETS.FIN_RECURRING);
  if (!s) return [];
  const data = s.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[FR.ID]) continue;
    out.push({ rowIndex: i + 1, id: finText(r[FR.ID]), kind: finText(r[FR.Kind]), majorKey: finText(r[FR.MajorKey]), subId: finText(r[FR.SubID]),
      amount: Number(r[FR.Amount]) || 0, description: finText(r[FR.Description]), party: finText(r[FR.Party]), method: finText(r[FR.Method]),
      forBranch: finText(r[FR.ForBranch]) || HEAD_OFFICE, dayOfMonth: Number(r[FR.DayOfMonth]) || 1,
      startMonth: dayString(r[FR.StartMonth]).slice(0, 7), active: r[FR.Active] === true || String(r[FR.Active]).toUpperCase() === 'TRUE' });
  }
  return out;
}

function monthAdd(ym, n) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(y, m, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Months (up to the last 3) where a repeat-monthly item is due but hasn't
// been confirmed or skipped yet.
function finDueItems() {
  const today = todayString();
  const thisMonth = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const entries = readFinanceEntries();
  const done = {};
  entries.forEach((e) => { if (e.recurringId && e.status.indexOf('Deleted') !== 0) done[e.recurringId + '|' + e.recurringMonth] = true; });
  const cats = finCategories();
  const due = [];
  readRecurring().filter((r) => r.active).forEach((r) => {
    for (let k = 2; k >= 0; k--) {
      const month = monthAdd(thisMonth, -k);
      if (month < r.startMonth) continue;
      if (month === thisMonth && day < r.dayOfMonth) continue;
      if (done[r.id + '|' + month]) continue;
      const sub = cats.subsById[r.subId];
      due.push({ recurringId: r.id, month: month, date: month + '-' + String(r.dayOfMonth).padStart(2, '0'), kind: r.kind,
        amount: r.amount, description: r.description, party: r.party, forBranch: r.forBranch,
        majorKey: r.majorKey, subId: r.subId, method: r.method,
        category: (finMajor(r.majorKey) || {}).name + ' › ' + (sub ? sub.name : '') });
    }
  });
  return due.sort((a, b) => a.date.localeCompare(b.date));
}

// The date a repeat item next needs recording: the earliest month from its
// start that hasn't been recorded or skipped (may be in the past = due now).
function finNextDue(r) {
  const done = {};
  readFinanceEntries().forEach((e) => { if (e.recurringId === r.id && e.status.indexOf('Deleted') !== 0) done[e.recurringMonth] = true; });
  const thisMonth = todayString().slice(0, 7);
  let m = monthAdd(thisMonth, -2);
  if (m < r.startMonth) m = r.startMonth;
  for (let i = 0; i < 36; i++, m = monthAdd(m, 1)) {
    if (!done[m]) return m + '-' + String(r.dayOfMonth).padStart(2, '0');
  }
  return '';
}

function getFinanceDue(email) {
  financeActor(email, 'capture');
  const cats = finCategories();
  return {
    success: true,
    due: finDueItems(),
    recurring: readRecurring().filter((r) => r.active).map((r) => ({
      id: r.id, kind: r.kind, amount: r.amount, description: r.description, forBranch: r.forBranch, dayOfMonth: r.dayOfMonth,
      majorKey: r.majorKey, subId: r.subId, party: r.party, method: r.method, nextDue: finNextDue(r),
      category: (finMajor(r.majorKey) || {}).name + ' › ' + ((cats.subsById[r.subId] || {}).name || '')
    }))
  };
}

function financeRecurringAction(body) {
  const actor = financeActor(body.requesterEmail, 'capture');
  const r = readRecurring().filter((x) => x.id === String(body.recurringId))[0];
  if (!r) return { success: false, error: 'Repeat-monthly item not found.' };
  const op = String(body.op || '');
  if (op === 'stop') {
    finRecSheet().getRange(r.rowIndex, FR.Active + 1).setValue(false);
    finRecSheet().getRange(r.rowIndex, FR.StoppedBy + 1, 1, 2).setValues([[actor.email, new Date()]]);
    return { success: true };
  }
  if (op === 'update') {
    // Changes apply from the next month recorded; past entries stay as they were.
    const cleaned = cleanFinanceEntry(Object.assign({}, body, { kind: r.kind, date: todayString() }));
    if (cleaned.error) return { success: false, error: cleaned.error };
    const e = cleaned.entry;
    const day = Math.round(Number(body.dayOfMonth));
    if (!(day >= 1 && day <= 28)) return { success: false, error: 'Choose a day from 1 to 28.' };
    const s = finRecSheet();
    const set = (h, v) => s.getRange(r.rowIndex, FR[h] + 1).setValue(v);
    set('MajorKey', e.majorKey); set('SubID', e.subId); set('Amount', e.amount); set('Description', e.description);
    set('Party', e.party); set('Method', e.method); set('ForBranch', e.forBranch); set('DayOfMonth', day);
    return { success: true };
  }
  const month = String(body.month || '');
  const isDue = finDueItems().some((d) => d.recurringId === r.id && d.month === month);
  if (!isDue) return { success: false, error: 'That month has already been dealt with.' };
  const cats = finCategories();
  const sub = cats.subsById[r.subId];
  const major = finMajor(r.majorKey);
  const base = { kind: r.kind, date: month + '-' + String(r.dayOfMonth).padStart(2, '0'), majorKey: r.majorKey, major: major ? major.name : '',
    subId: r.subId, sub: sub ? sub.name : '', amount: r.amount, description: r.description, party: r.party, method: r.method,
    reference: '', forBranch: r.forBranch };
  if (op === 'skip') {
    writeFinanceEntry(Object.assign(base, { amount: 0 }), actor, { RecurringID: r.id, RecurringMonth: "'" + month, Status: 'Skipped' });
    return { success: true };
  }
  if (op === 'confirm') {
    const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
    if (!(amount > 0) || amount > FIN_MAX_AMOUNT) return { success: false, error: 'Enter the amount.' };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : base.date;
    const id = writeFinanceEntry(Object.assign(base, { amount: amount, date: date }), actor, { RecurringID: r.id, RecurringMonth: "'" + month });
    return { success: true, id: id };
  }
  return { success: false, error: 'Unknown action.' };
}

// ── Overview & drill-down ────────────────────────────────────────────────

// Every income/expense line for the period, from all three sources.
function financeLines(range, branchFilter) {
  const lines = [];
  const inRange = (d) => d && d >= range.fromStr && d <= range.toStr;
  const branchOk = (b) => !branchFilter || branchFilter === b;
  const cats = finCategories();

  // 1. Head Office entries
  readFinanceEntries().forEach((e) => {
    if (e.status !== 'Active' || !inRange(e.date) || !branchOk(e.forBranch)) return;
    lines.push({ source: 'Head Office', ref: e.id, kind: e.kind, date: e.date, majorKey: e.majorKey, subId: e.subId,
      sub: (cats.subsById[e.subId] || {}).name || e.sub, amount: e.amount, description: e.description, party: e.party,
      branch: e.forBranch, file: e.receiptUrl ? { t: 'fin', r: e.id } : null, by: e.capturedBy });
  });

  // 2. Branch shop expenses
  const se = ss().getSheetByName(SHEETS.SHOP_EXPENSES);
  if (se) {
    const data = se.getDataRange().getValues();
    const lineNo = {}; // line number within each submission (for opening its receipt)
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0]) continue;
      lineNo[r[0]] = (lineNo[r[0]] || 0) + 1;
      const date = dayString(r[4]) || dayString(r[3]);
      if (!inRange(date) || !branchOk(r[2])) continue;
      let subId = finText(r[12]);
      if (!cats.subsById[subId]) subId = LEGACY_SHOP_TYPES[finText(r[7])] || 'other.sundry';
      const sub = cats.subsById[subId] || { majorKey: 'other', name: finText(r[7]) || 'Sundry' };
      lines.push({ source: 'Shop expense', ref: r[0], kind: 'Expense', date: date, majorKey: sub.majorKey, subId: subId, sub: sub.name,
        amount: Number(r[6]) || 0, description: finText(r[5]), party: '', branch: r[2],
        file: r[8] ? { t: 'shopReceipt', r: r[0], l: lineNo[r[0]] } : null, by: finText(r[10]) });
    }
  }

  // 3. Cash-ups: shop sales and in-store donations.
  // The till's Z-reading already includes donations, so each cash-up's
  // donations are taken out of its sales figure and shown separately under
  // Donations › In-store donations. Total income still equals nett sales.
  const cash = ss().getSheetByName(SHEETS.CASHUPS);
  if (cash) {
    const donationsBySub = {};
    const donationRows = [];
    const don = ss().getSheetByName(SHEETS.DONATIONS);
    if (don) {
      const dd = don.getDataRange().getValues();
      for (let i = 1; i < dd.length; i++) {
        if (!dd[i][0]) continue;
        const amt = Number(dd[i][2]) || 0;
        donationsBySub[dd[i][0]] = (donationsBySub[dd[i][0]] || 0) + amt;
        donationRows.push(dd[i]);
      }
    }
    const data = cash.getDataRange().getValues();
    const subInfo = {};
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0]) continue;
      const date = dayString(r[3]);
      if (!inRange(date) || !branchOk(r[2])) continue;
      subInfo[r[0]] = { date: date, branch: r[2] };
      const nett = Number(r[11]) || 0;
      const donated = donationsBySub[r[0]] || 0;
      lines.push({ source: 'Cash-up', ref: r[0], kind: 'Income', date: date, majorKey: 'shopsales', subId: 'shopsales.' + r[2], sub: r[2],
        amount: Math.round((nett - donated) * 100) / 100,
        description: donated ? 'Nett sales less in-store donations (' + nett.toFixed(2) + ' − ' + donated.toFixed(2) + ')' : 'Nett sales',
        party: '', branch: r[2], file: r[33] ? { t: 'cashup', r: r[0] } : null, by: finText(r[32]) });
    }
    donationRows.forEach((d) => {
      const info = subInfo[d[0]];
      if (!info) return;
      lines.push({ source: 'Cash-up', ref: d[0], kind: 'Income', date: info.date, majorKey: 'donations', subId: 'donations.instore',
        sub: FIN_AUTO_SUBS['donations.instore'].name, amount: Number(d[2]) || 0, description: 'Donation receipt ' + finText(d[1]),
        party: '', branch: info.branch, file: null, by: '' });
    });
  }
  return lines;
}

function financeRange(opts) {
  const range = resolveDashboardPeriod(opts.period, opts.from, opts.to);
  range.fromStr = Utilities.formatDate(range.from, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  range.toStr = Utilities.formatDate(range.to, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return range;
}

function getFinanceSummary(email, opts) {
  financeActor(email, 'view');
  const range = financeRange(opts || {});
  const branch = String((opts || {}).branch || '');
  const lines = financeLines(range, branch);
  const cats = finCategories();
  const majors = {};
  cats.majors.forEach((m) => { majors[m.key] = { key: m.key, kind: m.kind, name: m.name, hidden: m.hidden, total: 0, count: 0, subs: {} }; });
  let income = 0, expense = 0;
  lines.forEach((l) => {
    const m = majors[l.majorKey];
    if (!m) return;
    m.total += l.amount; m.count++;
    const s = m.subs[l.subId] || (m.subs[l.subId] = { id: l.subId, name: l.sub, total: 0, count: 0 });
    s.total += l.amount; s.count++;
    if (l.kind === 'Income') income += l.amount; else expense += l.amount;
  });
  const out = Object.keys(majors).map((k) => {
    const m = majors[k];
    return { key: m.key, kind: m.kind, name: m.name, total: Math.round(m.total * 100) / 100, count: m.count,
      subs: Object.keys(m.subs).map((s) => m.subs[s]).sort((a, b) => b.total - a.total) };
  }).filter((m) => m.count > 0 || !majors[m.key].hidden).sort((a, b) => b.total - a.total);
  return {
    success: true,
    range: { from: range.fromStr, to: range.toStr },
    branch: branch || 'Everything',
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    net: Math.round((income - expense) * 100) / 100,
    majors: out,
    dueCount: finDueItems().length
  };
}

function getFinanceEntries(email, opts) {
  financeActor(email, 'view');
  opts = opts || {};
  const range = financeRange(opts);
  let lines = financeLines(range, String(opts.branch || ''));
  if (opts.majorKey) lines = lines.filter((l) => l.majorKey === opts.majorKey);
  if (opts.subId) lines = lines.filter((l) => l.subId === opts.subId);
  if (opts.kind) lines = lines.filter((l) => l.kind === opts.kind);
  if (opts.source) lines = lines.filter((l) => l.source === opts.source);
  lines.sort((a, b) => b.date.localeCompare(a.date) || String(b.ref).localeCompare(String(a.ref)));
  const total = lines.reduce((t, l) => t + l.amount, 0);
  // Full details for Head Office entries so they can be edited from the list.
  const ho = {};
  if (lines.some((l) => l.source === 'Head Office')) readFinanceEntries().forEach((e) => { ho[e.id] = e; });
  return {
    success: true,
    range: { from: range.fromStr, to: range.toStr },
    total: Math.round(total * 100) / 100,
    count: lines.length,
    lines: lines.slice(0, 400).map((l) => {
      if (l.source !== 'Head Office' || !ho[l.ref]) return l;
      const e = ho[l.ref];
      return Object.assign({}, l, { method: e.method, reference: e.reference, recurringId: e.recurringId });
    })
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FILES — receipts, proof photos and PDFs are opened through the app only
//
// The app never receives Drive links. It asks for a file by what it belongs
// to (e.g. "the PDF of cash-up VCU-…", "receipt 2 of that submission"),
// and the file is returned only if the signed-in person's role may see that
// record. The Drive files themselves stay private to the script owner.
// ─────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function driveIdFromUrl(url) {
  const m = /\/d\/([-\w]{20,})/.exec(url) || /[?&]id=([-\w]{20,})/.exec(url);
  return m ? m[1] : '';
}

function getFile(email, t, ref, line) {
  ref = String(ref || '');
  let url = '';
  let title = '';
  if (t === 'cashup' || t === 'shopPdf' || t === 'shopReceipt') {
    requireAdminOrBackOffice(email);
    if (t === 'cashup') {
      const data = sheet(SHEETS.CASHUPS).getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === ref) { url = finText(data[i][33]); title = 'Cash-up ' + ref + ' · ' + data[i][2]; break; }
      }
    } else {
      const s = ss().getSheetByName(SHEETS.SHOP_EXPENSES);
      const rows = s ? s.getDataRange().getValues().filter((r, i) => i > 0 && String(r[0]) === ref) : [];
      if (t === 'shopPdf') {
        const withPdf = rows.filter((r) => r[9])[0];
        if (withPdf) { url = finText(withPdf[9]); title = 'Shop expenses ' + ref + ' · ' + withPdf[2]; }
      } else {
        const r = rows[(Number(line) || 0) - 1];
        if (r) { url = finText(r[8]); title = 'Receipt · ' + r[5] + ' · ' + r[2]; }
      }
    }
  } else if (t === 'proof') {
    const actor = jobsActor(email);
    const found = findJob(ref);
    if (found && canSeeJob(actor, found.job)) { url = found.job.proofUrl; title = 'Signed delivery note · ' + ref; }
  } else if (t === 'fin') {
    financeActor(email, 'view');
    const e = readFinanceEntries().filter((x) => x.id === ref)[0];
    if (e) { url = e.receiptUrl; title = 'Receipt · ' + e.id + ' · ' + e.description; }
  } else {
    return { success: false, error: 'Unknown file.' };
  }
  const id = url ? driveIdFromUrl(url) : '';
  if (!id) return { success: false, error: 'File not found.' };
  let file;
  try { file = DriveApp.getFileById(id); } catch (err) { return { success: false, error: 'The file could not be opened (it may have been moved or deleted).' }; }
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > MAX_FILE_BYTES) return { success: false, error: 'This file is too large to open in the app.' };
  return { success: true, title: title, name: file.getName(), mimeType: blob.getContentType(), data: Utilities.base64Encode(bytes) };
}

// ─────────────────────────────────────────────────────────────────────────
// DOWNLOADS (Pro feature "downloads") — CSV per dataset + Excel workbook
//
// Admins and Back Office only (the Users list: Admins only). Only business
// data is ever exported: Settings, SettingsLog, DevAuth, Notifications and
// the category list are internal and never included, developers are never
// listed, and customer names / contact numbers / addresses are left out of
// deliveries. Amounts come back as plain numbers and dates as yyyy-mm-dd;
// the app turns them into CSV / Excel.
// ─────────────────────────────────────────────────────────────────────────

const EXPORTS = [
  { key: 'ledger', title: 'Income & Expense Ledger', file: 'Ledger', description: 'Every rand in and out, from Head Office entries, shop expenses and cash-ups, with its category.' },
  { key: 'categorySummary', title: 'Category Summary', file: 'Category_Summary', description: 'Totals per month, category, subcategory and branch — ready for a budget or pivot table.' },
  { key: 'branchMonthly', title: 'Branch Monthly Summary', file: 'Branch_Monthly', description: 'Per branch per month: sales, card, cash, donations, short/over, shop expenses, Head Office costs and net.' },
  { key: 'cashups', title: 'Cash-Ups', file: 'CashUps', description: 'Every cash-up with all amounts, note and coin counts, explanations and sign-off.' },
  { key: 'donations', title: 'Donation Receipts', file: 'Donations', description: 'Each donation receipt recorded on a cash-up.' },
  { key: 'shopExpenses', title: 'Shop Expenses', file: 'Shop_Expenses', feature: 'shopExpenses', description: 'Each branch shop expense line with its category.' },
  { key: 'hoEntries', title: 'Head Office Entries', file: 'Head_Office_Entries', feature: 'hoExpenses', description: 'Head Office expenses and income, including deleted and skipped entries with their status.' },
  { key: 'deliveries', title: 'Deliveries & Collections', file: 'Deliveries', feature: 'deliveries', description: 'Each delivery and collection job (customer details are not included).' },
  { key: 'transfers', title: 'Inter-Branch Transfers', file: 'Transfers', feature: 'deliveries', description: 'Each transfer item line: requested, sent, received, condition and discrepancies.' },
  { key: 'jobHistory', title: 'Job History', file: 'Job_History', feature: 'deliveries', description: 'Every status change on deliveries, collections and transfers — the audit trail.' },
  { key: 'users', title: 'Users', file: 'Users', adminOnly: true, description: 'Everyone with access to the app, their role, branch and status.' }
];

function exportActor(email) {
  if (!isFeatureOn('downloads')) throw new Error('Downloads are not switched on.');
  return requireAdminOrBackOffice(email);
}

function exportsFor(user) {
  const isAdmin = user.row[6] === 'Admin' || user.row[6] === 'Developer';
  return EXPORTS.filter((x) => (!x.feature || isFeatureOn(x.feature)) && (!x.adminOnly || isAdmin));
}

function getExportCatalog(email) {
  const user = exportActor(email);
  return { success: true, name: CONFIG.EXPORT_NAME || 'Export', datasets: exportsFor(user).map((x) => ({ key: x.key, title: x.title, file: x.file, description: x.description })) };
}

function tsString(v) {
  return isDateValue(v) ? Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm') : finText(v);
}
const yesNo = (v) => (v ? 'Yes' : 'No');

function getExport(email, opts) {
  const user = exportActor(email);
  const def = exportsFor(user).filter((x) => x.key === opts.dataset)[0];
  if (!def) return { success: false, error: 'That download isn\'t available.' };
  const range = financeRange(opts);
  const branch = String(opts.branch || '');
  const inRange = (d) => !!d && d >= range.fromStr && d <= range.toStr;
  const branchOk = (b) => !branch || branch === b;
  const M = 'money', I = 'int', T = 'text', D = 'date';
  const col = (name, type) => ({ name: name, type: type || T });
  let columns = [];
  let rows = [];

  const cashRows = () => {
    const s = ss().getSheetByName(SHEETS.CASHUPS);
    return s ? s.getDataRange().getValues().slice(1).filter((r) => r[0] && inRange(dayString(r[3])) && branchOk(r[2])) : [];
  };
  const donationTotals = () => {
    const out = {};
    const s = ss().getSheetByName(SHEETS.DONATIONS);
    if (s) s.getDataRange().getValues().slice(1).forEach((r) => { if (r[0]) out[r[0]] = (out[r[0]] || 0) + (Number(r[2]) || 0); });
    return out;
  };
  const shopExpenseRows = () => {
    const s = ss().getSheetByName(SHEETS.SHOP_EXPENSES);
    if (!s) return [];
    const cats = finCategories();
    return s.getDataRange().getValues().slice(1).filter((r) => r[0]).map((r) => {
      let subId = finText(r[12]);
      if (!cats.subsById[subId]) subId = LEGACY_SHOP_TYPES[finText(r[7])] || 'other.sundry';
      const sub = cats.subsById[subId] || { majorKey: 'other', name: finText(r[7]) };
      return { r: r, date: dayString(r[4]) || dayString(r[3]), category: (finMajor(sub.majorKey) || {}).name || '', sub: sub.name };
    }).filter((x) => inRange(x.date) && branchOk(x.r[2]));
  };
  const majorName = (k) => (finMajor(k) || {}).name || k;

  if (def.key === 'ledger') {
    const ho = {};
    readFinanceEntries().forEach((e) => { ho[e.id] = e; });
    columns = [col('Date', D), col('Source'), col('Reference'), col('Branch'), col('Type'), col('Category'), col('Subcategory'),
      col('Description'), col('Paid to / Received from'), col('Method'), col('Invoice / reference'), col('Amount', M), col('Receipt or PDF in app')];
    rows = financeLines(range, branch).sort((a, b) => a.date.localeCompare(b.date)).map((l) => {
      const e = l.source === 'Head Office' ? ho[l.ref] : null;
      return [l.date, l.source, l.ref, l.branch, l.kind, majorName(l.majorKey), l.sub, l.description, l.party,
        e ? e.method : '', e ? e.reference : '', l.amount, yesNo(l.file)];
    });
  } else if (def.key === 'categorySummary') {
    columns = [col('Month'), col('Type'), col('Category'), col('Subcategory'), col('Branch'), col('Total', M), col('Entries', I)];
    const g = {};
    financeLines(range, branch).forEach((l) => {
      const k = [l.date.slice(0, 7), l.kind, majorName(l.majorKey), l.sub, l.branch].join('|');
      const x = g[k] || (g[k] = { key: k.split('|'), total: 0, n: 0 });
      x.total += l.amount; x.n++;
    });
    rows = Object.keys(g).sort().map((k) => g[k].key.concat([Math.round(g[k].total * 100) / 100, g[k].n]));
  } else if (def.key === 'branchMonthly') {
    columns = [col('Month'), col('Branch'), col('Cash-ups', I), col('Nett sales', M), col('Card sales', M), col('Cash', M),
      col('Donations (in sales)', M), col('Short / over', M), col('Shop expenses', M), col('Paid by Head Office for branch', M), col('Net', M)];
    const g = {};
    const at = (month, b) => g[month + '|' + b] || (g[month + '|' + b] = { month: month, branch: b, n: 0, nett: 0, card: 0, cash: 0, don: 0, so: 0, shop: 0, ho: 0 });
    const dons = donationTotals();
    cashRows().forEach((r) => {
      const x = at(dayString(r[3]).slice(0, 7), r[2]);
      x.n++; x.nett += Number(r[11]) || 0; x.card += Number(r[13]) || 0; x.cash += Number(r[24]) || 0;
      x.don += dons[r[0]] || 0; x.so += Number(r[26]) || 0;
    });
    shopExpenseRows().forEach((s) => { at(s.date.slice(0, 7), s.r[2]).shop += Number(s.r[6]) || 0; });
    readFinanceEntries().forEach((e) => {
      if (e.status !== 'Active' || e.kind !== 'Expense' || e.forBranch === HEAD_OFFICE || !inRange(e.date) || !branchOk(e.forBranch)) return;
      at(e.date.slice(0, 7), e.forBranch).ho += e.amount;
    });
    const r2 = (v) => Math.round(v * 100) / 100;
    rows = Object.keys(g).sort().map((k) => {
      const x = g[k];
      return [x.month, x.branch, x.n, r2(x.nett), r2(x.card), r2(x.cash), r2(x.don), r2(x.so), r2(x.shop), r2(x.ho), r2(x.nett - x.shop - x.ho)];
    });
  } else if (def.key === 'cashups') {
    const dons = donationTotals();
    columns = [col('Reference'), col('Submitted at'), col('Branch'), col('Date', D), col('Day'), col('Cashier'), col('Z reading no.'),
      col('Gross sales', M), col('Overings paid', M), col('Cash refunds', M), col('Expenses paid', M), col('Nett sales', M),
      col('Card sales (count)', I), col('Card sales', M),
      col('R200', I), col('R100', I), col('R50', I), col('R20', I), col('R10', I), col('R5', I), col('R2', I), col('R1', I),
      col('50c', I), col('20c', I), col('10c', I), col('5c', I), col('1c', I),
      col('Total cash', M), col('Total cards & cash', M), col('Short / over', M), col('Float retained', M), col('Donations', M),
      col('Overings explanation'), col('Refunds explanation'), col('Expenses explanation'), col('Short / over explanation'),
      col('Manager sign-off'), col('Submitted by'), col('PDF in app')];
    rows = cashRows().map((r) => [r[0], tsString(r[1]), r[2], dayString(r[3]), r[4], r[5], finText(r[6]),
      r[7], r[8], r[9], r[10], r[11], r[12], r[13],
      r[14], r[15], r[16], r[17], r[18], r[19], r[20], r[21], r[34], r[35], r[36], r[22], r[23],
      r[24], r[25], r[26], r[37], Math.round((dons[r[0]] || 0) * 100) / 100,
      r[27], r[28], r[29], r[30], r[31], r[32], yesNo(r[33])]);
  } else if (def.key === 'donations') {
    columns = [col('Cash-up reference'), col('Branch'), col('Cash-up date', D), col('Receipt no.'), col('Amount', M), col('Receipt date', D)];
    const info = {};
    cashRows().forEach((r) => { info[r[0]] = r; });
    const s = ss().getSheetByName(SHEETS.DONATIONS);
    if (s) rows = s.getDataRange().getValues().slice(1).filter((d) => info[d[0]])
      .map((d) => [d[0], info[d[0]][2], dayString(info[d[0]][3]), finText(d[1]), Number(d[2]) || 0, dayString(d[3])]);
  } else if (def.key === 'shopExpenses') {
    columns = [col('Cash-up reference'), col('Branch'), col('Cash-up date', D), col('Expense date', D), col('Category'), col('Subcategory'),
      col('Description'), col('Amount', M), col('Receipt in app'), col('Submitted by'), col('Submitted at')];
    rows = shopExpenseRows().map((x) => [x.r[0], x.r[2], dayString(x.r[3]), x.date, x.category, x.sub, x.r[5], Number(x.r[6]) || 0,
      yesNo(x.r[8]), x.r[10], tsString(x.r[1])]);
  } else if (def.key === 'hoEntries') {
    columns = [col('ID'), col('Date', D), col('Type'), col('Category'), col('Subcategory'), col('For'), col('Amount', M), col('Description'),
      col('Paid to / Received from'), col('Method'), col('Invoice / reference'), col('Repeat-monthly item'), col('Status'),
      col('Captured by'), col('Captured at'), col('Last changed by'), col('Receipt in app')];
    rows = readFinanceEntries().filter((e) => inRange(e.date) && branchOk(e.forBranch)).map((e) => [e.id, e.date, e.kind, e.major, e.sub,
      e.forBranch, e.amount, e.description, e.party, e.method, e.reference, e.recurringId, e.status, e.capturedBy, tsString(e.capturedAt),
      e.updatedBy, yesNo(e.receiptUrl)]);
  } else if (def.key === 'deliveries' || def.key === 'transfers' || def.key === 'jobHistory') {
    const jobs = {};
    const s = ss().getSheetByName(SHEETS.JOBS);
    if (s) jobsSheet().getDataRange().getValues().slice(1).forEach((r) => { if (r[JC.Ref]) { const j = jobFromRow(r); jobs[j.ref] = j; } });
    const jobBranchOk = (j) => branchOk(j.branch) || (!!j.receivingBranch && branchOk(j.receivingBranch));
    if (def.key === 'deliveries') {
      columns = [col('Reference'), col('Type'), col('Status'), col('Branch'), col('Item category'), col('Item description'),
        col('Required date', D), col('Driver'), col('Scheduled date', D), col('Approved by'), col('Approved at'),
        col('Completed by'), col('Completed at'), col('Proof in app'), col('Last failed attempt'), col('Logged by'), col('Logged at')];
      const valueOn = isFeatureOn('collectionValue');
      if (valueOn) columns.push(col('Estimated value', M));
      rows = Object.keys(jobs).map((k) => jobs[k]).filter((j) => j.type !== 'Transfer' && inRange(dayString(j.createdAt)) && jobBranchOk(j))
        .map((j) => [j.ref, j.type, j.status, j.branch, j.itemCategory, j.itemDescription, j.requiredDate, j.driverEmail, j.scheduledDate,
          j.approvedBy, tsString(j.approvedAt), j.completedBy, tsString(j.completedAt), yesNo(j.proofUrl), j.lastFailReason, j.createdBy, tsString(j.createdAt)]
          .concat(valueOn ? [j.type === 'Collection' && j.collectionValue !== null ? j.collectionValue : ''] : []));
    } else if (def.key === 'transfers') {
      columns = [col('Reference'), col('Status'), col('From'), col('To'), col('Requested date', D), col('Reason'), col('Line', I),
        col('Category'), col('Description'), col('Requested', I), col('Sent', I), col('Received', I), col('Condition'), col('Discrepancy'),
        col('Line note'), col('Dispatch date', D), col('Taken by'), col('Received by'), col('Received at'), col('Resolution')];
      const is = ss().getSheetByName(SHEETS.JOB_ITEMS);
      const items = is ? is.getDataRange().getValues().slice(1) : [];
      rows = items.filter((it) => { const j = jobs[it[0]]; return j && j.type === 'Transfer' && inRange(dayString(j.createdAt)) && jobBranchOk(j); })
        .map((it) => { const j = jobs[it[0]]; return [j.ref, j.status, j.branch, j.receivingBranch, j.requiredDate, j.reason, Number(it[1]) || 0,
          it[2], it[3], it[4], it[5], it[6], it[7], it[8], it[9], j.dispatchDate, j.driverEmail || j.responsiblePerson, j.receivedBy,
          tsString(j.receivedAt), j.resolutionNotes]; });
    } else {
      columns = [col('Reference'), col('Type'), col('Date & time'), col('From status'), col('To status'), col('By'), col('Notes')];
      const hs = ss().getSheetByName(SHEETS.JOB_HISTORY);
      const hist = hs ? hs.getDataRange().getValues().slice(1) : [];
      rows = hist.filter((h) => { const j = jobs[h[1]]; return j && inRange(dayString(h[0])) && jobBranchOk(j); })
        .map((h) => [h[1], jobs[h[1]].type, tsString(h[0]), h[2], h[3], h[4], h[5]]);
    }
  } else if (def.key === 'users') {
    columns = [col('Registered'), col('Full name'), col('Contact'), col('Email'), col('Requested branch'), col('Status'), col('Role'),
      col('Branch'), col('Approved by'), col('Approved date')];
    rows = sheet(SHEETS.USERS).getDataRange().getValues().slice(1).filter((r) => r[3] && r[6] !== 'Developer')
      .map((r) => [tsString(r[0]), r[1], finText(r[2]), r[3], r[4], r[5], r[6], r[7], r[8], tsString(r[9])]);
  }
  return {
    success: true, key: def.key, title: def.title, file: def.file, name: CONFIG.EXPORT_NAME || 'Export',
    range: { from: range.fromStr, to: range.toStr }, branch: branch, columns: columns, rows: rows
  };
}

// ─────────────────────────────────────────────────────────────────────────
// BRANCHES
// ─────────────────────────────────────────────────────────────────────────

function getBranches() {
  const s = sheet(SHEETS.BRANCHES);
  const data = s.getDataRange().getValues();
  const branches = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) branches.push(data[i][0]);
  }
  return branches;
}

// ─────────────────────────────────────────────────────────────────────────
// CASH-UP SUBMISSION
// ─────────────────────────────────────────────────────────────────────────

function submitCashUp(body) {
  const userFound = authUser(body.submittedByEmail);
  if (!userFound || userFound.row[5] !== 'Approved') {
    return { success: false, error: 'You are not an approved user.' };
  }

  const d = body.data;
  const num = (v) => Number(v) || 0;

  // Shop expenses (Pro) — checked before anything is written, so a bad
  // expense line can't leave a half-saved cash-up behind. Ignored entirely
  // when the feature is switched off.
  let expenseLines = [];
  if (isFeatureOn('shopExpenses') && Array.isArray(d.shopExpenses) && d.shopExpenses.length) {
    const cleaned = cleanShopExpenses(d.shopExpenses);
    if (cleaned.error) return { success: false, error: cleaned.error };
    expenseLines = cleaned.lines;
  }

  const totalNettSales = num(d.grossSales) - num(d.overingPaidAmount) - num(d.cashRefundsAmount) - num(d.expensePaidAmount);
  const totalCashOnly =
    num(d.r200) * 200 + num(d.r100) * 100 + num(d.r50) * 50 + num(d.r20) * 20 + num(d.r10) * 10 +
    num(d.r5) * 5 + num(d.r2) * 2 + num(d.r1) * 1 +
    num(d.c50) * 0.50 + num(d.c20) * 0.20 + num(d.c10) * 0.10 +
    num(d.c5) * 0.05 + num(d.c1) * 0.01;
  const totalCardsAndCash = totalCashOnly + num(d.totalCardSales);
  const shortOverAmount = totalCardsAndCash - totalNettSales;

  const now = new Date();
  const submissionId = 'VCU-' + Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss');

  const cashSheet = sheet(SHEETS.CASHUPS);
  cashSheet.appendRow([
    submissionId, now, d.branch, d.date, d.day, d.casher, d.zReadingNo, num(d.grossSales),
    num(d.overingPaidAmount), num(d.cashRefundsAmount), num(d.expensePaidAmount), totalNettSales,
    num(d.cardSalesCount), num(d.totalCardSales),
    num(d.r200), num(d.r100), num(d.r50), num(d.r20), num(d.r10),
    num(d.r5), num(d.r2), num(d.r1), num(d.c5), num(d.c1),
    totalCashOnly, totalCardsAndCash, shortOverAmount,
    d.overingExplain || '', d.refundsExplain || '', d.expensesExplain || '', d.shortOverExplain || '',
    d.managerName, body.submittedByEmail, '',
    num(d.c50), num(d.c20), num(d.c10),
    num(d.floatAmount) // column 38 = FloatAmount
  ]);
  const cashRowIndex = cashSheet.getLastRow();

  const donations = Array.isArray(d.donations) ? d.donations : [];
  let donationsTotal = 0;
  if (donations.length > 0) {
    const donSheet = sheet(SHEETS.DONATIONS);
    donations.forEach((don) => {
      donationsTotal += num(don.amount);
      donSheet.appendRow([submissionId, don.receiptNo || '', num(don.amount), don.receiptDate || '']);
    });
  }

  // Shop expense rows (with receipt links) are saved before any PDF work,
  // so the data is kept even if a PDF or the email fails.
  let expenseRowStart = 0;
  let expensesTotal = 0;
  const warnings = [];
  if (expenseLines.length) {
    const expSheet = ensureSheetHeaders(getOrCreateSheet(SHEETS.SHOP_EXPENSES, SHOP_EXPENSE_HEADERS), SHOP_EXPENSE_HEADERS);
    const rows = expenseLines.map((x, i) => {
      expensesTotal += x.amount;
      let receiptUrl = '';
      if (x.receiptImage) {
        try { receiptUrl = saveReceiptImage(x.receiptImage, d.branch, submissionId, i + 1); }
        catch (err) { warnings.push('Receipt ' + (i + 1) + ' could not be saved (' + err.message + ').'); }
      }
      return [submissionId, now, d.branch, d.date, x.date || d.date, x.description, x.amount, x.type, receiptUrl, '', body.submittedByEmail,
        x.categoryKey, x.subId, x.category, x.subcategory];
    });
    expenseRowStart = expSheet.getLastRow() + 1;
    expSheet.getRange(expenseRowStart, 1, rows.length, SHOP_EXPENSE_HEADERS.length).setValues(rows);
  }

  // Generate PDFs, then send ONE email with the cash-up PDF and (if there are
  // shop expenses) the Shop Expenses PDF as a second attachment.
  let pdfUrl = '';
  let cashFile = null;
  let expensesFile = null;
  try {
    const pdfBlob = buildCashUpPdf(d, {
      submissionId, totalNettSales, totalCashOnly, totalCardsAndCash, shortOverAmount, donations, donationsTotal
    });
    cashFile = savePdfToDrive(pdfBlob, d.branch, d.date, submissionId);
    pdfUrl = cashFile.getUrl();
    cashSheet.getRange(cashRowIndex, 34).setValue(pdfUrl); // column AH = PdfUrl
  } catch (err) {
    warnings.push('Cash-up PDF failed: ' + err.message);
  }

  if (expenseLines.length) {
    try {
      const expBlob = buildShopExpensesPdf(d, submissionId, expenseLines);
      expensesFile = savePdfToDrive(expBlob, d.branch, d.date, submissionId, 'ShopExpenses');
      getOrCreateSheet(SHEETS.SHOP_EXPENSES, SHOP_EXPENSE_HEADERS)
        .getRange(expenseRowStart, 10, expenseLines.length, 1)
        .setValues(expenseLines.map(() => [expensesFile.getUrl()])); // ExpensesPdfUrl
    } catch (err) {
      warnings.push('Shop Expenses PDF failed: ' + err.message);
    }
  }

  if (cashFile || expensesFile) {
    try {
      emailPdfToBackOffice(cashFile, d, submissionId, { totalNettSales, totalCashOnly, totalCardsAndCash, shortOverAmount },
        expensesFile, { count: expenseLines.length, total: expensesTotal });
    } catch (err) {
      warnings.push('Email failed: ' + err.message);
    }
  }

  // Submission is already saved even if a PDF/email step fails — surface it but don't block.
  const result = { success: true, submissionId: submissionId };
  if (warnings.length) result.pdfWarning = 'Saved, but: ' + warnings.join(' ');
  return result;
}

function requireAdminOrBackOffice(email) {
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved' || ['Admin', 'BackOffice', 'Developer'].indexOf(found.row[6]) === -1) {
    throw new Error('Not authorized.');
  }
  return found;
}

function getDashboardTotals(email) {
  requireAdminOrBackOffice(email);
  const cashSheet = sheet(SHEETS.CASHUPS);
  const cashData = cashSheet.getDataRange().getValues();

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const week = { count: 0, totalNettSales: 0, totalCardsAndCash: 0, totalShortOver: 0, totalDonations: 0 };
  const month = { count: 0, totalNettSales: 0, totalCardsAndCash: 0, totalShortOver: 0, totalDonations: 0 };
  const branchTotals = {};
  const subMeta = {}; // SubmissionID -> { branch, inWeek, inMonth } — used to bucket Donations rows below

  for (let i = 1; i < cashData.length; i++) {
    const row = cashData[i];
    const submissionId = row[0];
    const ts = new Date(row[1]); // Timestamp column
    if (isNaN(ts.getTime())) continue;

    const branch = row[2];
    const nett = Number(row[11]) || 0;
    const cards = Number(row[25]) || 0;
    const shortOver = Number(row[26]) || 0;

    const inWeek = ts >= weekStart;
    const inMonth = ts >= monthStart;
    subMeta[submissionId] = { branch: branch, inWeek: inWeek, inMonth: inMonth };

    if (inWeek) {
      week.count++;
      week.totalNettSales += nett;
      week.totalCardsAndCash += cards;
      week.totalShortOver += shortOver;
    }
    if (inMonth) {
      month.count++;
      month.totalNettSales += nett;
      month.totalCardsAndCash += cards;
      month.totalShortOver += shortOver;
      if (!branchTotals[branch]) branchTotals[branch] = { count: 0, totalNettSales: 0, totalDonations: 0 };
      branchTotals[branch].count++;
      branchTotals[branch].totalNettSales += nett;
    }
  }

  // Donations don't carry their own timestamp/branch — join back to the
  // parent CashUp submission (via SubmissionID) to know which week/month/branch each belongs to.
  const donSheet = sheet(SHEETS.DONATIONS);
  const donData = donSheet.getDataRange().getValues();
  for (let i = 1; i < donData.length; i++) {
    const row = donData[i];
    const submissionId = row[0];
    const amount = Number(row[2]) || 0;
    const meta = subMeta[submissionId];
    if (!meta) continue; // donation belongs to a submission outside our lookup window entirely
    if (meta.inWeek) week.totalDonations += amount;
    if (meta.inMonth) {
      month.totalDonations += amount;
      if (!branchTotals[meta.branch]) branchTotals[meta.branch] = { count: 0, totalNettSales: 0, totalDonations: 0 };
      branchTotals[meta.branch].totalDonations += amount;
    }
  }

  const byBranch = Object.keys(branchTotals)
    .map((b) => ({
      branch: b,
      count: branchTotals[b].count,
      totalNettSales: branchTotals[b].totalNettSales,
      totalDonations: branchTotals[b].totalDonations || 0
    }))
    .sort((a, b) => b.totalNettSales - a.totalNettSales);

  return { success: true, week: week, month: month, byBranch: byBranch };
}

function resolveDashboardPeriod(period, fromStr, toStr) {
  const tz = CONFIG.TIMEZONE;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  let from, to;
  switch (period) {
    case 'thisWeek':
      from = addDays(todayStart, -6);
      to = endOfDay(now);
      break;
    case 'lastMonth': {
      const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      from = new Date(y, m, 1);
      to = endOfDay(new Date(y, m + 1, 0));
      break;
    }
    case 'last3Months':
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      to = endOfDay(now);
      break;
    case 'last6Months':
      from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      to = endOfDay(now);
      break;
    case 'thisYear':
      from = new Date(now.getFullYear(), 0, 1);
      to = endOfDay(now);
      break;
    case 'lastYear':
      from = new Date(now.getFullYear() - 1, 0, 1);
      to = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
      break;
    case 'custom': {
      from = fromStr ? startOfDay(new Date(fromStr)) : new Date(now.getFullYear(), now.getMonth(), 1);
      to = toStr ? endOfDay(new Date(toStr)) : endOfDay(now);
      break;
    }
    case 'thisMonth':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = endOfDay(now);
      break;
  }
  return { from: from, to: to };
}

// Daily buckets for a short range, weekly for a medium range, monthly for a
// long one — keeps the trend chart from becoming an unreadable wall of bars.
function pickGranularity(from, to) {
  const days = Math.round((to - from) / 86400000);
  if (days <= 62) return 'daily';
  if (days <= 186) return 'weekly';
  return 'monthly';
}

function bucketKey(date, granularity) {
  if (granularity === 'daily') {
    return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  if (granularity === 'weekly') {
    // Monday-start week key, labelled by that Monday's date.
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - day);
    return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM');
}

function bucketLabel(key, granularity) {
  if (granularity === 'monthly') {
    const parts = key.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return Utilities.formatDate(d, CONFIG.TIMEZONE, 'MMM yyyy');
  }
  const d = new Date(key + 'T00:00:00');
  return granularity === 'weekly'
    ? 'Wk of ' + Utilities.formatDate(d, CONFIG.TIMEZONE, 'd MMM')
    : Utilities.formatDate(d, CONFIG.TIMEZONE, 'd MMM');
}

function getDashboardV2(email, opts) {
  requireAdminOrBackOffice(email);
  opts = opts || {};
  const branchFilter = opts.branch && opts.branch !== 'All Branches' ? opts.branch : '';
  const range = resolveDashboardPeriod(opts.period, opts.from, opts.to);
  const granularity = pickGranularity(range.from, range.to);

  const cashSheet = sheet(SHEETS.CASHUPS);
  const cashData = cashSheet.getDataRange().getValues();

  const kpis = { count: 0, totalNettSales: 0, totalCardsAndCash: 0, totalCardSales: 0, totalCashOnly: 0, totalShortOver: 0, totalDonations: 0 };
  const trendMap = {};       // bucketKey -> { nettSales, count }
  const byBranchMap = {};    // branch -> { count, totalNettSales, totalDonations }
  const subMeta = {};        // SubmissionID -> { branch, inRange, date }
  const branchTrendMap = {}; // branch -> { bucketKey -> nettSales } — for "Branch Performance Over Time",
                             // always bucketed regardless of the branch filter so it can compare branches.

  // Rolling 12-month history always covers the same fixed window (last 12
  // calendar months, regardless of the period selector above), so the
  // administrator has a stable "how does this compare over time" view.
  const historyMonths = [];
  const nowForHistory = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(nowForHistory.getFullYear(), nowForHistory.getMonth() - i, 1);
    historyMonths.push(Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM'));
  }
  const historyMap = {}; // yyyy-MM -> nettSales
  historyMonths.forEach((m) => { historyMap[m] = 0; });

  for (let i = 1; i < cashData.length; i++) {
    const row = cashData[i];
    const submissionId = row[0];
    const branch = row[2];
    // The Date column (business date entered on the form) drives all
    // period/trend bucketing — it's the date the cash-up is FOR, whereas
    // Timestamp is merely when it happened to be submitted.
    const dateVal = row[3] instanceof Date ? row[3] : new Date(row[3]);
    if (isNaN(dateVal.getTime())) continue;

    const nett = Number(row[11]) || 0;
    const cardSales = Number(row[13]) || 0;   // TotalCardSales
    const cashOnly = Number(row[24]) || 0;    // TotalCashOnly
    const cards = Number(row[25]) || 0;       // TotalCardsAndCash (= cardSales + cashOnly)
    const shortOver = Number(row[26]) || 0;

    // Rolling 12-month history respects the branch filter but not the period filter.
    if (!branchFilter || branch === branchFilter) {
      const hKey = Utilities.formatDate(dateVal, CONFIG.TIMEZONE, 'yyyy-MM');
      if (hKey in historyMap) historyMap[hKey] += nett;
    }

    const inRange = dateVal >= range.from && dateVal <= range.to;
    const matchesBranch = !branchFilter || branch === branchFilter;
    subMeta[submissionId] = { branch: branch, inRange: inRange && matchesBranch, date: dateVal };

    // Branch Performance Over Time always buckets every branch across the
    // selected period (ignoring the branch filter), so the comparison chart
    // can show all branches side by side even when one is selected elsewhere.
    if (inRange) {
      if (!branchTrendMap[branch]) branchTrendMap[branch] = {};
      const bKey = bucketKey(dateVal, granularity);
      branchTrendMap[branch][bKey] = (branchTrendMap[branch][bKey] || 0) + nett;
    }

    if (!inRange || !matchesBranch) continue;

    kpis.count++;
    kpis.totalNettSales += nett;
    kpis.totalCardsAndCash += cards;
    kpis.totalCardSales += cardSales;
    kpis.totalCashOnly += cashOnly;
    kpis.totalShortOver += shortOver;

    const key = bucketKey(dateVal, granularity);
    if (!trendMap[key]) trendMap[key] = { nettSales: 0, count: 0, cardsAndCash: 0, shortOver: 0, donations: 0 };
    trendMap[key].nettSales += nett;
    trendMap[key].count += 1;
    trendMap[key].cardsAndCash += cards;
    trendMap[key].shortOver += shortOver;

    if (!byBranchMap[branch]) byBranchMap[branch] = { count: 0, totalNettSales: 0, totalDonations: 0 };
    byBranchMap[branch].count++;
    byBranchMap[branch].totalNettSales += nett;
  }

  const donSheet = sheet(SHEETS.DONATIONS);
  const donData = donSheet.getDataRange().getValues();
  for (let i = 1; i < donData.length; i++) {
    const row = donData[i];
    const submissionId = row[0];
    const amount = Number(row[2]) || 0;
    const meta = subMeta[submissionId];
    if (!meta || !meta.inRange) continue;
    kpis.totalDonations += amount;
    if (!byBranchMap[meta.branch]) byBranchMap[meta.branch] = { count: 0, totalNettSales: 0, totalDonations: 0 };
    byBranchMap[meta.branch].totalDonations += amount;
    const dKey = bucketKey(meta.date, granularity);
    if (!trendMap[dKey]) trendMap[dKey] = { nettSales: 0, count: 0, cardsAndCash: 0, shortOver: 0, donations: 0 };
    trendMap[dKey].donations += amount;
  }

  // Build an ordered list of every bucket key in [range.from, range.to] so
  // gaps (no submissions that day/week/month) show as zero, not a missing point.
  const trend = [];
  const cursor = new Date(range.from);
  const seenKeys = {};
  while (cursor <= range.to) {
    const key = bucketKey(cursor, granularity);
    if (!seenKeys[key]) {
      seenKeys[key] = true;
      const bucket = trendMap[key] || { nettSales: 0, count: 0, cardsAndCash: 0, shortOver: 0, donations: 0 };
      trend.push({
        key: key,
        label: bucketLabel(key, granularity),
        nettSales: bucket.nettSales,
        submissions: bucket.count,
        cardsAndCash: bucket.cardsAndCash,
        shortOver: bucket.shortOver,
        donations: bucket.donations
      });
    }
    cursor.setDate(cursor.getDate() + (granularity === 'monthly' ? 28 : 1));
  }

  const byBranch = Object.keys(byBranchMap)
    .map((b) => ({
      branch: b,
      count: byBranchMap[b].count,
      totalNettSales: byBranchMap[b].totalNettSales,
      totalDonations: byBranchMap[b].totalDonations || 0
    }))
    .sort((a, b) => b.totalNettSales - a.totalNettSales);

  // Same bucket keys/labels as `trend`, one Nett Sales series per branch —
  // powers "Branch Performance Over Time" (req #10) without a separate endpoint.
  const branchNames = Object.keys(branchTrendMap).sort();
  const trendByBranch = branchNames.map((b) => ({
    branch: b,
    series: trend.map((t) => branchTrendMap[b][t.key] || 0)
  }));

  const monthlyHistory = historyMonths.map((m) => ({
    key: m,
    label: bucketLabel(m, 'monthly'),
    nettSales: historyMap[m]
  }));

  return {
    success: true,
    period: opts.period || 'thisMonth',
    branch: branchFilter || 'All Branches',
    range: { from: Utilities.formatDate(range.from, CONFIG.TIMEZONE, 'yyyy-MM-dd'), to: Utilities.formatDate(range.to, CONFIG.TIMEZONE, 'yyyy-MM-dd') },
    granularity: granularity,
    kpis: kpis,
    trend: trend,
    byBranch: byBranch,
    trendByBranch: trendByBranch,
    monthlyHistory: monthlyHistory,
    branches: getBranches()
  };
}

// Powers the "Short / Over" KPI card's click-through breakdown — the same
// period+branch filters as getDashboardV2, but returns the underlying
// per-submission rows (ShortOverAmount + ShortOverExplain) instead of totals.
function getShortOverDetail(email, opts) {
  requireAdminOrBackOffice(email);
  opts = opts || {};
  const branchFilter = opts.branch && opts.branch !== 'All Branches' ? opts.branch : '';
  const range = resolveDashboardPeriod(opts.period, opts.from, opts.to);

  const cashSheet = sheet(SHEETS.CASHUPS);
  const cashData = cashSheet.getDataRange().getValues();

  const rows = [];
  let totalShortOver = 0;
  let balancedCount = 0;
  for (let i = 1; i < cashData.length; i++) {
    const row = cashData[i];
    const branch = row[2];
    const dateVal = row[3] instanceof Date ? row[3] : new Date(row[3]);
    if (isNaN(dateVal.getTime())) continue;
    if (dateVal < range.from || dateVal > range.to) continue;
    if (branchFilter && branch !== branchFilter) continue;

    const shortOver = Number(row[26]) || 0;
    totalShortOver += shortOver;

    // Balanced (R0.00) submissions carry nothing to investigate — leave them
    // out of the list so the popup only shows what actually needs a look,
    // but still count them so the summary line can say how many were fine.
    if (Math.abs(shortOver) < 0.005) { balancedCount++; continue; }

    rows.push({
      submissionId: row[0],
      branch: branch,
      date: Utilities.formatDate(dateVal, CONFIG.TIMEZONE, 'yyyy-MM-dd'),
      cashier: row[5],
      shortOverAmount: shortOver,
      shortOverExplain: row[30] || '',
      pdfFile: row[33] ? { t: 'cashup', r: row[0] } : null
    });
  }

  // Largest discrepancies first (either direction) — that's what an admin
  // clicking through from the KPI card actually wants to see first.
  rows.sort((a, b) => Math.abs(b.shortOverAmount) - Math.abs(a.shortOverAmount));

  return {
    success: true,
    branch: branchFilter || 'All Branches',
    range: { from: Utilities.formatDate(range.from, CONFIG.TIMEZONE, 'yyyy-MM-dd'), to: Utilities.formatDate(range.to, CONFIG.TIMEZONE, 'yyyy-MM-dd') },
    totalShortOver: totalShortOver,
    balancedCount: balancedCount,
    rows: rows
  };
}

function getRecentSubmissions(branch, email) {
  const found = authUser(email);
  if (!found || found.row[5] !== 'Approved') {
    return { success: false, error: 'Not authorized.' };
  }
  const isAdminOrBackOffice = ['Admin', 'BackOffice', 'Developer'].indexOf(found.row[6]) !== -1;
  const s = sheet(SHEETS.CASHUPS);
  const data = s.getDataRange().getValues();
  const rows = [];
  for (let i = data.length - 1; i >= 1 && rows.length < 20; i--) {
    const row = data[i];
    if (isAdminOrBackOffice || row[2] === branch) {
      rows.push({
        submissionId: row[0], branch: row[2], date: row[3], timestamp: row[1], casher: row[5],
        totalNettSales: row[11], totalCardsAndCash: row[25], shortOverAmount: row[26],
        pdfFile: row[33] ? { t: 'cashup', r: row[0] } : null
      });
    }
  }
  return { success: true, submissions: rows };
}

// ─────────────────────────────────────────────────────────────────────────
// PDF GENERATION
// ─────────────────────────────────────────────────────────────────────────

function buildCashUpPdf(d, totals) {
  let logoImg = '';
  try {
    const logoBlob = UrlFetchApp.fetch(CONFIG.LOGO_URL).getBlob();
    logoImg = 'data:' + logoBlob.getContentType() + ';base64,' + Utilities.base64Encode(logoBlob.getBytes());
  } catch (err) {
    logoImg = '';
  }

  const rand = function (v) {
    const num = Number(v || 0);
    const fixed = num.toFixed(2);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return 'R ' + parts.join('.');
  };
  const esc = function (v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };

  // If the cashier attached a photo of the handwritten Daily Sales Sheet,
  // it's appended here as a second page of the SAME PDF (not a separate
  // file/email) — this is what "one document" means for this request.
  let salesSheetPageHtml = '';
  if (d.salesSheetImage) {
    salesSheetPageHtml =
      '<div class="sales-sheet-page">' +
      '<div class="section-title">DAILY SALES SHEET (attached photo)</div>' +
      '<img src="' + d.salesSheetImage + '" />' +
      '</div>';
  }

  const donationRows = totals.donations.map(function (don) {
    return '<tr><td>' + esc(don.receiptNo) + '</td><td>R ' + Number(don.amount).toFixed(2) + '</td><td>' + esc(don.receiptDate) + '</td></tr>';
  }).join('');

  const html =
    '<html><head><style>' +
    '@page{size:A4;margin:9mm;}' +
    'body{font-family:Arial,sans-serif;font-size:8.5px;color:#1a1a1a;}' +
    'h2{font-size:15px;}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:4px;}' +
    'td,th{border:1px solid #333;padding:2px 4px;text-align:left;line-height:1.2;}' +
    'th{background:#f0f0f0;}' +
    '.brand{color:#E6007E;font-size:16px;font-weight:bold;}' +
    '.section-title{background:#1a1a1a;color:#fff;padding:2px 5px;font-weight:bold;margin-top:2px;}' +
    '.total-row{font-weight:bold;background:#f7f7f7;}' +
    '.short{color:#c0392b;font-weight:bold;}' +
    '.over{color:#1e8449;font-weight:bold;}' +
    // The sales-sheet photo gets its own page, and is capped to the printable
    // height of a single A4 page (with the @page margins above) so a tall
    // phone photo can't itself spill onto a third page.
    '.sales-sheet-page{page-break-before:always;padding-top:6px;text-align:center;}' +
    '.sales-sheet-page img{max-width:100%;max-height:265mm;width:auto;height:auto;}' +
    '</style></head><body>' +
    // NOTE: a real <table> (not CSS display:table/table-cell) is used for the
    // header row — Apps Script's PDF renderer is an old engine with patchy
    // support for CSS table-display properties, and a real <table> is the
    // reliable way to get a logo-left / heading-right layout in the output PDF.
    '<table style="border:none;width:100%;margin-bottom:6px;"><tr>' +
    '<td style="border:none;width:60%;vertical-align:middle;">' + (logoImg ? '<img src="' + logoImg + '" height="95"/>' : '<div class="brand">' + CONFIG.ORG_NAME + '</div>') + '</td>' +
    '<td style="border:none;width:40%;text-align:right;vertical-align:middle;"><h2 style="margin:0;">DAILY CASH-UP</h2></td>' +
    '</tr></table>' +
    '<table><tr><td><b>Branch</b></td><td>' + esc(d.branch) + '</td><td><b>Date &amp; Day</b></td><td>' + esc(d.date) + ' (' + esc(d.day) + ')</td><td><b>Cashier</b></td><td>' + esc(d.casher) + '</td></tr></table>' +

    '<div class="section-title">Z READING &amp; SALES SUMMARY</div>' +
    '<table>' +
    '<tr><td>Z Reading No.</td><td>' + esc(d.zReadingNo) + '</td></tr>' +
    '<tr><td>Z Reading Gross Sales</td><td>' + rand(d.grossSales) + '</td></tr>' +
    '<tr><td>Overing Paid Amount</td><td>' + rand(d.overingPaidAmount) + '</td></tr>' +
    '<tr><td>Cash Refunds Amount</td><td>' + rand(d.cashRefundsAmount) + '</td></tr>' +
    '<tr><td>Expense Paid Amount</td><td>' + rand(d.expensePaidAmount) + '</td></tr>' +
    '<tr class="total-row"><td>TOTAL NETT SALES</td><td>' + rand(totals.totalNettSales) + '</td></tr>' +
    '</table>' +

    '<div class="section-title">DAILY DONATIONS</div>' +
    '<table><tr><th>Receipt No</th><th>Amount</th><th>Receipt Date</th></tr>' +
    donationRows +
    '<tr class="total-row"><td>TOTAL</td><td>' + rand(totals.donationsTotal) + '</td><td></td></tr>' +
    '</table>' +

    '<div class="section-title">CASH BREAKDOWN &amp; RECONCILIATION</div>' +
    '<table>' +
    '<tr><td>No. of Card Sales</td><td>' + esc(d.cardSalesCount) + '</td><td>Total Card Sales</td><td>' + rand(d.totalCardSales) + '</td></tr>' +
    '</table>' +
    '<table>' +
    '<tr><th>Notes</th><th>Count</th><th>Coins</th><th>Count</th></tr>' +
    '<tr><td>R200</td><td>' + esc(d.r200) + '</td><td>R5</td><td>' + esc(d.r5) + '</td></tr>' +
    '<tr><td>R100</td><td>' + esc(d.r100) + '</td><td>R2</td><td>' + esc(d.r2) + '</td></tr>' +
    '<tr><td>R50</td><td>' + esc(d.r50) + '</td><td>R1</td><td>' + esc(d.r1) + '</td></tr>' +
    '<tr><td>R20</td><td>' + esc(d.r20) + '</td><td>50c</td><td>' + esc(d.c50) + '</td></tr>' +
    '<tr><td>R10</td><td>' + esc(d.r10) + '</td><td>20c</td><td>' + esc(d.c20) + '</td></tr>' +
    '<tr><td></td><td></td><td>10c</td><td>' + esc(d.c10) + '</td></tr>' +
    '<tr><td></td><td></td><td>5c</td><td>' + esc(d.c5) + '</td></tr>' +
    '<tr><td></td><td></td><td>1c</td><td>' + esc(d.c1) + '</td></tr>' +
    '</table>' +
    '<table>' +
    '<tr class="total-row"><td>Total Cash Only</td><td>' + rand(totals.totalCashOnly) + '</td></tr>' +
    '<tr class="total-row"><td>Total Cards and Cash</td><td>' + rand(totals.totalCardsAndCash) + '</td></tr>' +
    '<tr class="total-row"><td>Short / Over</td><td class="' + (totals.shortOverAmount < 0 ? 'short' : 'over') + '">' + rand(totals.shortOverAmount) + '</td></tr>' +
    '<tr><td>Float Retained</td><td>' + rand(d.floatAmount) + '</td></tr>' +
    '</table>' +

    '<div class="section-title">EXPLANATIONS &amp; SIGN-OFF</div>' +
    '<table>' +
    '<tr><td>Overings paid out</td><td>' + esc(d.overingExplain) + '</td></tr>' +
    '<tr><td>Refunds paid out</td><td>' + esc(d.refundsExplain) + '</td></tr>' +
    '<tr><td>Expenses paid out</td><td>' + esc(d.expensesExplain) + '</td></tr>' +
    '<tr><td>Short or over</td><td>' + esc(d.shortOverExplain) + '</td></tr>' +
    '<tr><td>Manager</td><td>' + esc(d.managerName) + '</td></tr>' +
    '</table>' +
    '<p style="color:#666;font-size:9px;">Submission ID: ' + esc(totals.submissionId) + '</p>' +
    salesSheetPageHtml +
    '</body></html>';

  return Utilities.newBlob(html, 'text/html', 'cashup.html').getAs('application/pdf');
}

function savePdfToDrive(pdfBlob, branch, date, submissionId, prefix) {
  const rootName = 'Vision CashUp PDFs';
  let root = null;
  const rootIter = DriveApp.getFoldersByName(rootName);
  root = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder(rootName);

  let branchFolder = null;
  const branchIter = root.getFoldersByName(branch);
  branchFolder = branchIter.hasNext() ? branchIter.next() : root.createFolder(branch);

  const filename = (prefix || 'CashUp') + '_' + branch.replace(/\s+/g, '') + '_' + date + '_' + submissionId + '.pdf';
  pdfBlob.setName(filename);
  return branchFolder.createFile(pdfBlob);
}

function emailPdfToBackOffice(file, d, submissionId, totals, expensesFile, expensesInfo) {
  const s = sheet(SHEETS.USERS);
  const data = s.getDataRange().getValues();
  const recipients = [];
  const add = (email) => {
    const e = String(email || '').trim();
    if (e && recipients.map((r) => r.toLowerCase()).indexOf(e.toLowerCase()) === -1) recipients.push(e);
  };
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === 'Approved' && data[i][6] === 'BackOffice') add(data[i][3]);
  }
  add(CONFIG.CASHUP_EMAIL_ALWAYS);
  if (recipients.length === 0) return;

  const attachments = [];
  if (file) attachments.push(file.getAs(MimeType.PDF));
  if (expensesFile) attachments.push(expensesFile.getAs(MimeType.PDF));
  const expensesText = expensesFile && expensesInfo
    ? 'Shop expenses: ' + expensesInfo.count + ' item' + (expensesInfo.count === 1 ? '' : 's') +
      ', total R ' + Number(expensesInfo.total).toFixed(2) + ' (separate PDF attached).\n'
    : '';

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: 'Cash-Up submitted — ' + d.branch + ' — ' + d.date,
    body:
      'A new daily cash-up has been submitted.\n\n' +
      'Branch: ' + d.branch + '\n' +
      'Date: ' + d.date + '\n' +
      'Cashier: ' + d.casher + '\n' +
      'Total Nett Sales: R ' + Number(totals.totalNettSales).toFixed(2) + '\n' +
      'Total Cards & Cash: R ' + Number(totals.totalCardsAndCash).toFixed(2) + '\n' +
      'Short/Over: R ' + Number(totals.shortOverAmount).toFixed(2) + '\n' +
      'Submission ID: ' + submissionId + '\n' +
      expensesText + '\n' +
      (file ? 'The full cash-up sheet is attached as a PDF.' : 'The cash-up PDF could not be generated — see the CashUps sheet.'),
    attachments: attachments
  });
}