const API_BASE = import.meta.env.VITE_API_URL || "";

function getToken() {
  return localStorage.getItem("evoting_token");
}

function getCredentialHeader() {
  try {
    // optional: last used credential for /me restore
    const last = localStorage.getItem("evoting_last_national_id");
    if (!last) return null;
    return localStorage.getItem("evoting_credential:" + last);
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const cred = getCredentialHeader();
  if (cred) headers["X-Voter-Credential"] = cred;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "Invalid response" };
  }

  if (!res.ok) {
    const msg =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.message || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    err.code = data?.code;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/api/health"),
  config: () => request("/api/config"),
  demoVoters: () => request("/api/demo/voters"),
  login: (nationalId, pin, credential) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ nationalId, pin, credential: credential || undefined }),
    }),
  register: (payload) =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  regions: () => request("/api/auth/regions"),
  me: () => request("/api/auth/me"),
  elections: () => request("/api/elections"),
  election: (id) => request(`/api/elections/${id}`),
  results: (id) => request(`/api/elections/${id}/results`),
  requestPermit: (electionId) =>
    request("/api/vote/permit", {
      method: "POST",
      body: JSON.stringify({ electionId }),
    }),
  castDemo: (electionId, candidateId) =>
    request("/api/vote/cast-demo", {
      method: "POST",
      body: JSON.stringify({ electionId, candidateId }),
    }),
  confirmVote: (electionId, txHash) =>
    request("/api/vote/confirm", {
      method: "POST",
      body: JSON.stringify({ electionId, txHash }),
    }),
  voteStatus: (electionId) => request(`/api/vote/status/${electionId}`),
  recentEvents: () => request("/api/events/recent"),
  adminAudit: () => request("/api/admin/audit"),
  adminVoters: () => request("/api/admin/voters"),
  adminElections: () => request("/api/admin/elections"),
  adminCreateElection: (payload) =>
    request("/api/admin/elections", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminUpdateElection: (id, payload) =>
    request(`/api/admin/elections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  adminAddCandidate: (electionId, payload) =>
    request(`/api/admin/elections/${electionId}/candidates`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminRemoveCandidate: (electionId, candidateId) =>
    request(`/api/admin/elections/${electionId}/candidates/${candidateId}`, {
      method: "DELETE",
    }),
  adminDeleteElection: (id) =>
    request(`/api/admin/elections/${id}`, {
      method: "DELETE",
    }),
};

export function openEventStream(onMessage) {
  const base = API_BASE || "";
  const es = new EventSource(`${base}/api/events/stream`);
  es.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  return es;
}
