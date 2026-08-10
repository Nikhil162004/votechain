const STORE_KEY = "evoting_saved_accounts";
const LAST_ID_KEY = "evoting_last_national_id";
const CRED_PREFIX = "evoting_credential:";

/**
 * Browser-local vault so registered accounts survive Vercel cold starts.
 * Stores: nationalId, name, credential JWT (server-signed), never stores PIN in plain text long-term
 * (we optionally keep last PIN only if user checks "remember" — we do NOT store PIN by default).
 */

export function listSavedAccounts() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAccount({ nationalId, name, credential }) {
  if (!nationalId || !credential) return;
  const id = String(nationalId).trim().toUpperCase();
  const list = listSavedAccounts().filter((a) => a.nationalId !== id);
  list.unshift({
    nationalId: id,
    name: name || id,
    credential,
    savedAt: new Date().toISOString(),
  });
  localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 20)));
  localStorage.setItem(LAST_ID_KEY, id);
  localStorage.setItem(CRED_PREFIX + id, credential);
}

export function getCredential(nationalId) {
  if (!nationalId) return null;
  const id = String(nationalId).trim().toUpperCase();
  const direct = localStorage.getItem(CRED_PREFIX + id);
  if (direct) return direct;
  const found = listSavedAccounts().find((a) => a.nationalId === id);
  return found?.credential || null;
}

export function getLastNationalId() {
  return localStorage.getItem(LAST_ID_KEY) || "";
}

export function clearAccount(nationalId) {
  const id = String(nationalId || "").trim().toUpperCase();
  localStorage.removeItem(CRED_PREFIX + id);
  const list = listSavedAccounts().filter((a) => a.nationalId !== id);
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
}
