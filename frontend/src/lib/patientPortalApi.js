import axios from "axios";

// Deliberately separate from lib/api.js's `api` instance: that one auto-attaches the
// STAFF session token and, on any 401, clears the staff session and reloads the page.
// A patient's own session expiring must never touch a logged-in staff member's session
// in another tab, so this client carries its own token and has no such interceptor.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const PORTAL_SESSION_KEY = "fitsiomax_patient_portal_session";

const portalApi = axios.create({ baseURL: `${BACKEND_URL}/api/v3` });

export const loadPortalSession = () => {
  try {
    const raw = localStorage.getItem(PORTAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const savePortalSession = (data) => {
  localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(data));
};

export const clearPortalSession = () => {
  localStorage.removeItem(PORTAL_SESSION_KEY);
};

const authHeaders = () => {
  const token = loadPortalSession()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const patientPortalLogin = async (email, password) => {
  const { data } = await portalApi.post("/patient-portal/login", { email, password });
  return data;
};

export const patientPortalGoogleLogin = async (credential) => {
  const { data } = await portalApi.post("/patient-portal/google-login", { credential });
  return data;
};

export const patientPortalLogout = async () => {
  try {
    await portalApi.post("/patient-portal/logout", null, { headers: authHeaders() });
  } catch { /* token may already be gone — logging out locally still succeeds */ }
};

export const patientPortalMe = async () => {
  const { data } = await portalApi.get("/patient-portal/me", { headers: authHeaders() });
  return data;
};

export const patientPortalDocuments = async () => {
  const { data } = await portalApi.get("/patient-portal/documents", { headers: authHeaders() });
  return data;
};

/** The bytes, as an object URL. Fetched as a blob rather than linked to directly: the
    route needs the session token in a header, which a plain <a href> cannot send. The
    caller owns the URL and must revokeObjectURL it when done. */
export const patientPortalDocumentUrl = async (docId) => {
  const { data } = await portalApi.get(`/patient-portal/documents/${docId}/download`, {
    headers: authHeaders(),
    responseType: "blob",
  });
  return URL.createObjectURL(data);
};
