/**
 * In-memory store for demo / local development.
 * Swap with Postgres/Mongo in production.
 */

const voters = new Map(); // nationalIdHash -> voter record
const sessions = new Map(); // token -> session
const issuedPermits = new Map(); // `${electionId}:${nullifier}` -> meta
const auditLog = [];

function hashId(nationalId) {
  // Simple deterministic hash for demo (backend uses ethers keccak later for nullifier)
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(String(nationalId).trim().toUpperCase()).digest("hex");
}

// Seed demo voters (password = last 4 of national id for simplicity in demo)
const DEMO_VOTERS = [
  { nationalId: "VOTER-1001", name: "Demo Voter One", email: "voter1@demo.local", region: "Pune" },
  { nationalId: "VOTER-1002", name: "Demo Voter Two", email: "voter2@demo.local", region: "Mumbai" },
  { nationalId: "VOTER-1003", name: "Demo Voter Three", email: "voter3@demo.local", region: "Delhi" },
  { nationalId: "VOTER-1004", name: "Demo Voter Four", email: "voter4@demo.local", region: "Bengaluru" },
  { nationalId: "VOTER-1005", name: "Demo Voter Five", email: "voter5@demo.local", region: "Hyderabad" },
  { nationalId: "ADMIN-0001", name: "Election Admin", email: "admin@demo.local", region: "HQ", isAdmin: true },
];

for (const v of DEMO_VOTERS) {
  const idHash = hashId(v.nationalId);
  voters.set(idHash, {
    idHash,
    nationalId: v.nationalId,
    name: v.name,
    email: v.email,
    region: v.region,
    isAdmin: !!v.isAdmin,
    // Demo PIN: last 4 chars of nationalId
    pin: v.nationalId.slice(-4),
    verified: true,
    registeredAt: new Date().toISOString(),
    electionsVoted: [], // electionIds where permit was issued / vote confirmed
  });
}

function findByCredentials(nationalId, pin) {
  const idHash = hashId(nationalId);
  const voter = voters.get(idHash);
  if (!voter) return null;
  if (String(pin) !== String(voter.pin)) return null;
  // Only eligible / verified voters may authenticate to vote
  if (voter.eligible === false || voter.verified === false) return null;
  return voter;
}

function getVoter(idHash) {
  return voters.get(idHash) || null;
}

function markVoted(idHash, electionId) {
  const v = voters.get(idHash);
  if (!v) return;
  if (!v.electionsVoted.includes(Number(electionId))) {
    v.electionsVoted.push(Number(electionId));
  }
}

function hasVoted(idHash, electionId) {
  const v = voters.get(idHash);
  if (!v) return false;
  return v.electionsVoted.includes(Number(electionId));
}

function recordPermit(electionId, nullifier, meta) {
  issuedPermits.set(`${electionId}:${nullifier}`, { ...meta, issuedAt: Date.now() });
}

function getPermit(electionId, nullifier) {
  return issuedPermits.get(`${electionId}:${nullifier}`) || null;
}

function log(event, data = {}) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  auditLog.push(entry);
  if (auditLog.length > 5000) auditLog.shift();
  return entry;
}

function getAuditLog(limit = 100) {
  return auditLog.slice(-limit).reverse();
}

function listVotersPublic() {
  return [...voters.values()].map((v) => ({
    name: v.name,
    region: v.region,
    isAdmin: v.isAdmin,
    eligible: v.eligible !== false && v.verified !== false,
    verified: v.verified !== false,
    nationalIdMasked: v.nationalId.replace(/.(?=.{4})/g, "•"),
    electionsVoted: v.electionsVoted,
    registeredAt: v.registeredAt || null,
    source: v.source || (v.isAdmin ? "seed-admin" : "seed-demo"),
  }));
}

function findByNationalId(nationalId) {
  return voters.get(hashId(nationalId)) || null;
}

function findByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  for (const v of voters.values()) {
    if (String(v.email || "").toLowerCase() === e) return v;
  }
  return null;
}

function findByPhone(phone) {
  const p = String(phone || "").trim();
  if (!p) return null;
  for (const v of voters.values()) {
    if (v.phone && String(v.phone) === p) return v;
  }
  return null;
}

/**
 * Register a validated eligible voter. Caller must run validateRegistration first.
 */
function registerVoter(data) {
  const idHash = hashId(data.nationalId);
  if (voters.has(idHash)) {
    const err = new Error("A voter with this National / Voter ID is already registered");
    err.code = "DUPLICATE_ID";
    throw err;
  }
  if (findByEmail(data.email)) {
    const err = new Error("This email is already registered");
    err.code = "DUPLICATE_EMAIL";
    throw err;
  }
  if (data.phone && findByPhone(data.phone)) {
    const err = new Error("This mobile number is already registered");
    err.code = "DUPLICATE_PHONE";
    throw err;
  }

  const record = {
    idHash,
    nationalId: data.nationalId,
    name: data.name,
    email: data.email,
    phone: data.phone || "",
    region: data.region,
    dob: data.dob,
    age: data.age,
    isAdmin: false,
    pin: data.pin,
    verified: true,
    eligible: true,
    source: "self-registration",
    registeredAt: new Date().toISOString(),
    electionsVoted: [],
  };
  voters.set(idHash, record);
  log("voter_registered", {
    idHash: idHash.slice(0, 12),
    region: data.region,
    age: data.age,
  });
  return record;
}

module.exports = {
  hashId,
  findByCredentials,
  getVoter,
  markVoted,
  hasVoted,
  recordPermit,
  getPermit,
  log,
  getAuditLog,
  listVotersPublic,
  findByNationalId,
  findByEmail,
  findByPhone,
  registerVoter,
  DEMO_VOTERS,
};
