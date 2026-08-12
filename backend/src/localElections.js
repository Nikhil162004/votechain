/**
 * Local (file-backed) elections created by admin on laptop.
 * Complements on-chain elections from Hardhat.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "local-elections.json");

const STATUS_LABELS = ["Draft", "Upcoming", "Active", "Ended", "Cancelled"];

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ electionCounter: 1000, elections: {}, nullifiers: {}, events: [] }, null, 2)
    );
  }
}

function load() {
  ensure();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function save(state) {
  ensure();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function publicElection(e) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startTime: e.startTime,
    endTime: e.endTime,
    status: e.status,
    statusLabel: e.statusLabel || STATUS_LABELS[e.status] || "Draft",
    candidateCount: e.candidateCount || (e.candidates || []).length,
    totalVotes: e.totalVotes || 0,
    source: "local",
  };
}

function list() {
  const state = load();
  return Object.values(state.elections || {})
    .sort((a, b) => Number(b.id) - Number(a.id))
    .map((e) => ({ ...publicElection(e), candidates: e.candidates || [] }));
}

function get(id) {
  const state = load();
  const e = state.elections[String(id)];
  if (!e) return null;
  return e;
}

function parseWhen(value, fieldName) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const t = Date.parse(String(value));
  if (Number.isNaN(t)) {
    const err = new Error(`Invalid ${fieldName || "date"}`);
    err.status = 400;
    throw err;
  }
  return Math.floor(t / 1000);
}

function create(body, adminName = "admin") {
  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  if (!title || title.length < 3) {
    const err = new Error("Title is required (min 3 characters)");
    err.status = 400;
    throw err;
  }
  if (!description) {
    const err = new Error("Description is required");
    err.status = 400;
    throw err;
  }

  let startTime = parseWhen(body?.startTime, "startTime");
  let endTime = parseWhen(body?.endTime, "endTime");
  const now = Math.floor(Date.now() / 1000);
  if (startTime == null) startTime = now + 3600;
  if (endTime == null) endTime = startTime + 7 * 24 * 3600;
  if (endTime <= startTime) {
    const err = new Error("End time must be after start time");
    err.status = 400;
    throw err;
  }

  let status = Number(body?.status);
  if (![0, 1, 2, 3, 4].includes(status)) status = 1;

  const state = load();
  const id = Math.max(Number(state.electionCounter || 1000), 1000) + 1;
  state.electionCounter = id;

  const election = {
    id,
    title,
    description,
    startTime,
    endTime,
    status,
    statusLabel: STATUS_LABELS[status],
    candidateCount: 0,
    totalVotes: 0,
    candidates: [],
    createdAt: new Date().toISOString(),
    createdBy: adminName,
    source: "local",
  };
  state.elections[String(id)] = election;
  state.events = state.events || [];
  state.events.unshift({
    type: "ElectionCreated",
    electionId: id,
    title,
    timestamp: now,
    name: adminName,
  });
  save(state);
  return election;
}

function update(id, body, adminName = "admin") {
  const state = load();
  const e = state.elections[String(id)];
  if (!e) {
    const err = new Error("Election not found");
    err.status = 404;
    throw err;
  }

  if (body?.title != null) {
    const t = String(body.title).trim();
    if (t.length < 3) {
      const err = new Error("Title too short");
      err.status = 400;
      throw err;
    }
    e.title = t;
  }
  if (body?.description != null) e.description = String(body.description).trim();
  if (body?.startTime != null) e.startTime = parseWhen(body.startTime, "startTime");
  if (body?.endTime != null) e.endTime = parseWhen(body.endTime, "endTime");
  if (e.endTime <= e.startTime) {
    const err = new Error("End time must be after start time");
    err.status = 400;
    throw err;
  }
  if (body?.status != null) {
    const status = Number(body.status);
    if (![0, 1, 2, 3, 4].includes(status)) {
      const err = new Error("Invalid status (0–4)");
      err.status = 400;
      throw err;
    }
    if (status === 2 && (!e.candidates || e.candidates.length === 0)) {
      const err = new Error("Add at least one candidate before activating");
      err.status = 400;
      throw err;
    }
    e.status = status;
    e.statusLabel = STATUS_LABELS[status];
  }

  state.events.unshift({
    type: "ElectionUpdated",
    electionId: e.id,
    title: e.title,
    timestamp: Math.floor(Date.now() / 1000),
    name: adminName,
  });
  save(state);
  return e;
}

function addCandidate(id, body, adminName = "admin") {
  const name = String(body?.name || "").trim();
  const party = String(body?.party || "").trim();
  const manifesto = String(body?.manifesto || "").trim();
  if (!name) {
    const err = new Error("Candidate name is required");
    err.status = 400;
    throw err;
  }
  if (!party) {
    const err = new Error("Party is required");
    err.status = 400;
    throw err;
  }

  const state = load();
  const e = state.elections[String(id)];
  if (!e) {
    const err = new Error("Election not found");
    err.status = 404;
    throw err;
  }
  if (e.status === 3 || e.status === 4) {
    const err = new Error("Cannot add candidates to ended/cancelled elections");
    err.status = 400;
    throw err;
  }
  if (e.status === 2 && Number(e.totalVotes || 0) > 0) {
    const err = new Error("Cannot add candidates after voting has started");
    err.status = 400;
    throw err;
  }

  if (!Array.isArray(e.candidates)) e.candidates = [];
  const nextId = e.candidates.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
  const candidate = {
    id: nextId,
    name,
    party,
    manifesto: manifesto || "No manifesto provided.",
    voteCount: 0,
    exists: true,
  };
  e.candidates.push(candidate);
  e.candidateCount = e.candidates.length;
  state.events.unshift({
    type: "CandidateAdded",
    electionId: e.id,
    candidateName: name,
    timestamp: Math.floor(Date.now() / 1000),
    name: adminName,
  });
  save(state);
  return { election: e, candidate };
}

function removeCandidate(id, candidateId, adminName = "admin") {
  const state = load();
  const e = state.elections[String(id)];
  if (!e) {
    const err = new Error("Election not found");
    err.status = 404;
    throw err;
  }
  if (Number(e.totalVotes || 0) > 0) {
    const err = new Error("Cannot remove candidates after votes exist");
    err.status = 400;
    throw err;
  }
  const cid = Number(candidateId);
  const before = e.candidates?.length || 0;
  e.candidates = (e.candidates || []).filter((c) => Number(c.id) !== cid);
  if (e.candidates.length === before) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  e.candidateCount = e.candidates.length;
  state.events.unshift({
    type: "CandidateRemoved",
    electionId: e.id,
    timestamp: Math.floor(Date.now() / 1000),
    name: adminName,
  });
  save(state);
  return e;
}

function removeElection(id, adminName = "admin") {
  const state = load();
  const e = state.elections[String(id)];
  if (!e) {
    const err = new Error("Election not found");
    err.status = 404;
    throw err;
  }
  if (Number(e.totalVotes || 0) > 0) {
    const err = new Error("Cannot delete an election that already has votes. End or cancel it instead.");
    err.status = 400;
    throw err;
  }
  delete state.elections[String(id)];
  state.events.unshift({
    type: "ElectionDeleted",
    electionId: Number(id),
    title: e.title,
    timestamp: Math.floor(Date.now() / 1000),
    name: adminName,
  });
  save(state);
  return true;
}

function resultsOf(e) {
  return {
    candidates: (e.candidates || []).map((c) => ({
      id: c.id,
      name: c.name,
      party: c.party,
      votes: c.voteCount || 0,
    })),
    totalVotes: e.totalVotes || 0,
    updatedAt: new Date().toISOString(),
  };
}

function castVote(electionId, candidateId, idHash) {
  const state = load();
  const e = state.elections[String(electionId)];
  if (!e) {
    const err = new Error("Election not found");
    err.status = 404;
    throw err;
  }
  if (e.status !== 2) {
    const err = new Error(`Election is not active (status=${e.statusLabel})`);
    err.status = 400;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now < e.startTime) {
    const err = new Error("Election has not started");
    err.status = 400;
    throw err;
  }
  if (now > e.endTime) {
    const err = new Error("Election has ended");
    err.status = 400;
    throw err;
  }

  const nullifier = crypto
    .createHash("sha256")
    .update(`local:${idHash}:${electionId}`)
    .digest("hex");
  const nKey = `${electionId}:${nullifier}`;
  state.nullifiers = state.nullifiers || {};
  if (state.nullifiers[nKey]) {
    const err = new Error("You have already voted in this election");
    err.status = 409;
    err.alreadyVoted = true;
    err.results = resultsOf(e);
    throw err;
  }

  const cand = (e.candidates || []).find((c) => Number(c.id) === Number(candidateId));
  if (!cand) {
    const err = new Error("Invalid candidate");
    err.status = 400;
    throw err;
  }

  state.nullifiers[nKey] = true;
  cand.voteCount = Number(cand.voteCount || 0) + 1;
  e.totalVotes = Number(e.totalVotes || 0) + 1;

  const txHash = "0x" + crypto.createHash("sha256").update(`${nullifier}:${candidateId}:${Date.now()}`).digest("hex");
  const event = {
    type: "VoteCast",
    electionId: Number(electionId),
    candidateId: Number(candidateId),
    nullifier: "0x" + nullifier,
    caster: "0xLocalDemoCaster",
    newCandidateTally: cand.voteCount,
    newTotalVotes: e.totalVotes,
    timestamp: now,
    txHash,
    blockNumber: 1000 + e.totalVotes,
    mode: "local",
  };
  state.events = state.events || [];
  state.events.unshift(event);
  save(state);

  return {
    ok: true,
    mode: "local-file-store",
    txHash,
    blockNumber: event.blockNumber,
    caster: event.caster,
    nullifier: event.nullifier,
    results: resultsOf(e),
    election: publicElection(e),
    candidates: e.candidates,
  };
}

function isLocalId(id) {
  // local elections use ids > 1000
  return Number(id) > 1000;
}

function recentVoteEvents(limit = 50) {
  const state = load();
  return (state.events || []).filter((e) => e.type === "VoteCast").slice(0, limit);
}

function auditEvents(limit = 80) {
  const state = load();
  return (state.events || []).slice(0, limit);
}

module.exports = {
  STATUS_LABELS,
  publicElection,
  list,
  get,
  create,
  update,
  addCandidate,
  removeCandidate,
  removeElection,
  resultsOf,
  castVote,
  isLocalId,
  recentVoteEvents,
  auditEvents,
};
