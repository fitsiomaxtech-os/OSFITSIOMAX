const SESSION_KEY = "physiofit_crm_session";

// Each tab holds its own sign-in in sessionStorage, so several accounts can be signed in
// side by side in one browser — a second login in another tab no longer replaces this
// tab's account, and signing out there no longer throws this tab back to the login page.
//
// localStorage keeps a copy of the most recent sign-in only so that a fresh tab, or the
// browser reopened, starts signed in instead of asking again. A tab adopts that copy once,
// the first time it loads, and from then on reads only its own.

const readJson = (storage) => {
  try {
    const raw = storage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const loadSession = () => {
  const own = readJson(sessionStorage);
  if (own) return own;
  const shared = readJson(localStorage);
  if (shared) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(shared)); } catch { /* noop */ }
  }
  return shared;
};

export const saveSession = (data) => {
  const raw = JSON.stringify(data);
  try { sessionStorage.setItem(SESSION_KEY, raw); } catch { /* noop */ }
  try { localStorage.setItem(SESSION_KEY, raw); } catch { /* noop */ }
};

export const clearSession = () => {
  const token = readJson(sessionStorage)?.token;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
  // Only drop the shared copy when it is this tab's own account. If another tab has since
  // signed in as someone else, that sign-in is theirs and stays.
  if (!token || readJson(localStorage)?.token === token) {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
  }
};
