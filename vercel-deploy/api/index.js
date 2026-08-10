/**
 * VoteChain API — Vercel serverless
 * Demo mode: in-memory + long-lived registration credentials (JWT)
 * so logins survive cold starts when the browser still has the credential.
 */
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ethers } from "ethers";
import { validateRegistration, REGIONS } from "./validation.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "100kb" }));

const JWT_SECRET = process.env.JWT_SECRET || "votechain-vercel-demo-secret-change-me";
const NULLIFIER_PEPPER = process.env.NULLIFIER_PEPPER || "evoting-nullifier-pepper-v1";
const CREDENTIAL_TTL = "365d";

const g = globalThis;
if (!g.__votechain) {
  g.__votechain = {
    voters: new Map(),
    nullifiers: new Set(),
    elections: new Map(),
    events: [],
  };
  seed(g.__votechain);
}
const store = g.__votechain;

function hashId(nationalId) {
  return crypto.createHash("sha256").update(String(nationalId).trim().toUpperCase()).digest("hex");
}

function hashPin(pin, idHash) {
  return crypto.createHash("sha256").update(`${idHash}:${String(pin)}`).digest("hex");
}

function seed(s) {
  const DEMO = [
    { nationalId: "VOTER-1001", name: "Demo Voter One", email: "voter1@demo.local", region: "Pune" },
    { nationalId: "VOTER-1002", name: "Demo Voter Two", email: "voter2@demo.local", region: "Mumbai" },
    { nationalId: "VOTER-1003", name: "Demo Voter Three", email: "voter3@demo.local", region: "Delhi" },
    { nationalId: "VOTER-1004", name: "Demo Voter Four", email: "voter4@demo.local", region: "Bengaluru" },
    { nationalId: "VOTER-1005", name: "Demo Voter Five", email: "voter5@demo.local", region: "Hyderabad" },
    { nationalId: "ADMIN-0001", name: "Election Admin", email: "admin@demo.local", region: "HQ", isAdmin: true },
  ];
  for (const v of DEMO) {
    const idHash = hashId(v.nationalId);
    s.voters.set(idHash, {
      idHash,
      nationalId: v.nationalId,
      name: v.name,
      email: v.email,
      region: v.region,
      phone: "",
      isAdmin: !!v.isAdmin,
      pin: v.nationalId.slice(-4),
      pinHash: hashPin(v.nationalId.slice(-4), idHash),
      verified: true,
      eligible: true,
      source: v.isAdmin ? "seed-admin" : "seed-demo",
      registeredAt: new Date().toISOString(),
      electionsVoted: [],
    });
  }
  s.DEMO_VOTERS = DEMO;

  const now = Math.floor(Date.now() / 1000);
  s.elections.set(1, {
    id: 1,
    title: "General Election 2026",
    description:
      "National parliamentary election — identity verified off-chain; ballots use cryptographic nullifiers. (Vercel demo mode)",
    startTime: now - 3600,
    endTime: now + 30 * 24 * 3600,
    status: 2,
    statusLabel: "Active",
    candidateCount: 4,
    totalVotes: 0,
    candidates: [
      {
        id: 1,
        name: "Aarav Sharma",
        party: "Progressive Alliance",
        manifesto: "Focus on education, digital infrastructure, and green energy.",
        voteCount: 0,
        exists: true,
      },
      {
        id: 2,
        name: "Priya Patel",
        party: "Unity Front",
        manifesto: "Healthcare for all, rural development, and job creation.",
        voteCount: 0,
        exists: true,
      },
      {
        id: 3,
        name: "Rohan Mehta",
        party: "Future Party",
        manifesto: "Startup ecosystem, tax reform, and transparent governance.",
        voteCount: 0,
        exists: true,
      },
      {
        id: 4,
        name: "Ananya Singh",
        party: "People First",
        manifesto: "Women empowerment, environmental protection, and social justice.",
        voteCount: 0,
        exists: true,
      },
    ],
  });
}

function publicUser(v) {
  return {
    name: v.name,
    email: v.email,
    region: v.region,
    isAdmin: !!v.isAdmin,
    eligible: v.eligible !== false,
    verified: v.verified !== false,
    nationalIdMasked: String(v.nationalId || "").replace(/.(?=.{4})/g, "•"),
    electionsVoted: v.electionsVoted || [],
  };
}

function issueCredential(voter, pin) {
  const pinHash = voter.pinHash || hashPin(pin, voter.idHash);
  return jwt.sign(
    {
      typ: "voter_credential",
      idHash: voter.idHash,
      nationalId: voter.nationalId,
      pinHash,
      name: voter.name,
      email: voter.email,
      phone: voter.phone || "",
      region: voter.region,
      dob: voter.dob || null,
      isAdmin: !!voter.isAdmin,
      eligible: true,
      verified: true,
    },
    JWT_SECRET,
    { expiresIn: CREDENTIAL_TTL }
  );
}

function issueSession(voter) {
  return jwt.sign({ idHash: voter.idHash, isAdmin: !!voter.isAdmin }, JWT_SECRET, { expiresIn: "8h" });
}

function upsertVoterFromCredential(payload) {
  let voter = store.voters.get(payload.idHash);
  if (!voter) {
    voter = {
      idHash: payload.idHash,
      nationalId: payload.nationalId,
      name: payload.name,
      email: payload.email,
      phone: payload.phone || "",
      region: payload.region,
      dob: payload.dob || null,
      isAdmin: !!payload.isAdmin,
      pin: null, // pin only known via hash after restore
      pinHash: payload.pinHash,
      verified: true,
      eligible: true,
      source: "credential-restore",
      registeredAt: new Date().toISOString(),
      electionsVoted: [],
    };
    store.voters.set(payload.idHash, voter);
  } else {
    voter.pinHash = voter.pinHash || payload.pinHash;
    voter.eligible = true;
    voter.verified = true;
  }
  return voter;
}

function findByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  for (const v of store.voters.values()) {
    if (String(v.email || "").toLowerCase() === e) return v;
  }
  return null;
}

function findByPhone(phone) {
  const p = String(phone || "").trim();
  if (!p) return null;
  for (const v of store.voters.values()) {
    if (v.phone && String(v.phone) === p) return v;
  }
  return null;
}

function registerVoter(data) {
  const idHash = hashId(data.nationalId);
  if (store.voters.has(idHash)) {
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
  const pinHash = hashPin(data.pin, idHash);
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
    pinHash,
    verified: true,
    eligible: true,
    source: "self-registration",
    registeredAt: new Date().toISOString(),
    electionsVoted: [],
  };
  store.voters.set(idHash, record);
  pushEvent({
    type: "VoterRegistered",
    electionId: null,
    timestamp: Math.floor(Date.now() / 1000),
    name: data.name,
    region: data.region,
  });
  return record;
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    let voter = store.voters.get(payload.idHash);
    // Restore from session if missing from memory (cold start) using optional credential header
    if (!voter && req.headers["x-voter-credential"]) {
      try {
        const cred = jwt.verify(String(req.headers["x-voter-credential"]), JWT_SECRET);
        if (cred.typ === "voter_credential" && cred.idHash === payload.idHash) {
          voter = upsertVoterFromCredential(cred);
        }
      } catch {
        /* ignore */
      }
    }
    if (!voter) {
      return res.status(401).json({
        error: "Session expired after server restart. Please log in again with your Voter ID and PIN.",
        code: "SESSION_STALE",
      });
    }
    req.user = voter;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function computeNullifier(idHash, electionId) {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "string"], [idHash, BigInt(electionId), NULLIFIER_PEPPER])
  );
}

function pushEvent(ev) {
  store.events.unshift(ev);
  if (store.events.length > 100) store.events.pop();
}

function pinMatches(voter, pin) {
  if (!voter) return false;
  if (voter.pin != null && String(voter.pin) === String(pin)) return true;
  const h = hashPin(pin, voter.idHash);
  if (voter.pinHash && voter.pinHash === h) return true;
  return false;
}

// ── Routes ─────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "votechain-vercel",
    mode: process.env.CONTRACT_ADDRESS ? "on-chain" : "demo",
    votersInMemory: store.voters.size,
    time: new Date().toISOString(),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    contractAddress: process.env.CONTRACT_ADDRESS || null,
    chainId: Number(process.env.CHAIN_ID || 0),
    permitSigner: process.env.PERMIT_SIGNER || null,
    mode: process.env.CONTRACT_ADDRESS ? "on-chain" : "demo",
    rpcUrl: null,
  });
});

app.get("/api/demo/voters", (_req, res) => {
  res.json({
    note: "Demo only — PIN is the last 4 characters of National ID",
    voters: (store.DEMO_VOTERS || []).map((v) => ({
      nationalId: v.nationalId,
      name: v.name,
      pin: v.nationalId.slice(-4),
      isAdmin: !!v.isAdmin,
    })),
  });
});

app.get("/api/auth/regions", (_req, res) => {
  res.json({ regions: REGIONS });
});

app.post("/api/auth/register", (req, res) => {
  const result = validateRegistration(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ error: result.errors[0], errors: result.errors });
  }
  try {
    const voter = registerVoter(result.data);
    const token = issueSession(voter);
    const credential = issueCredential(voter, result.data.pin);
    res.status(201).json({
      ok: true,
      message: "Registration successful. You are eligible to vote. Save your Voter ID and PIN — you need them to log in.",
      token,
      credential, // browser stores this so login works after cold starts
      loginHint: {
        nationalId: voter.nationalId,
        note: "Use this exact Voter ID and the PIN you just created on the Login page.",
      },
      user: publicUser(voter),
    });
  } catch (err) {
    const status = err.code && String(err.code).startsWith("DUPLICATE") ? 409 : 500;
    return res.status(status).json({ error: err.message });
  }
});

/**
 * Login:
 * 1) Look up voter in memory
 * 2) If missing (cold start), accept browser-stored registration credential JWT
 *    and verify PIN against pinHash inside it, then restore voter to memory
 */
app.post("/api/auth/login", (req, res) => {
  const { nationalId, pin, credential } = req.body || {};
  if (!nationalId || !pin) {
    return res.status(400).json({ error: "nationalId and pin are required" });
  }

  const normalizedId = String(nationalId).trim().toUpperCase();
  const idHash = hashId(normalizedId);
  let voter = store.voters.get(idHash);
  let restored = false;

  // Restore from long-lived registration credential (saved in browser at register time)
  if (!voter && credential) {
    try {
      const payload = jwt.verify(String(credential), JWT_SECRET);
      if (payload.typ !== "voter_credential") throw new Error("bad typ");
      if (payload.idHash !== idHash && String(payload.nationalId || "").toUpperCase() !== normalizedId) {
        throw new Error("id mismatch");
      }
      const expected = hashPin(pin, payload.idHash);
      if (payload.pinHash !== expected) {
        return res.status(401).json({
          error: "Invalid PIN for this saved account",
          code: "BAD_PIN",
        });
      }
      voter = upsertVoterFromCredential({ ...payload, nationalId: payload.nationalId || normalizedId });
      // keep plain pin in memory for this instance (optional)
      voter.pin = String(pin);
      restored = true;
    } catch {
      return res.status(401).json({
        error:
          "Account not found on server (demo reset). Your saved browser credential is invalid. Please Register again.",
        code: "NEED_REREGISTER",
      });
    }
  }

  if (!voter) {
    return res.status(401).json({
      error:
        "Invalid credentials or voter not registered. If you registered earlier on this site, the demo server may have restarted — open Register again with the same details, or use a demo account.",
      code: "NOT_FOUND",
      hint: "Use the exact Voter ID and PIN from registration. Demo example: VOTER-1002 / 1002",
    });
  }

  if (voter.eligible === false || voter.verified === false) {
    return res.status(403).json({ error: "Your account is not eligible to vote." });
  }

  if (!pinMatches(voter, pin)) {
    return res.status(401).json({
      error: "Invalid PIN. Use the PIN you created during registration (not your phone number).",
      code: "BAD_PIN",
    });
  }

  // Ensure pinHash exists for future restores
  if (!voter.pinHash) voter.pinHash = hashPin(pin, voter.idHash);
  voter.pin = String(pin);

  const token = issueSession(voter);
  const newCredential = issueCredential(voter, pin);

  res.json({
    token,
    credential: newCredential,
    restored,
    user: publicUser(voter),
    loginHint: { nationalId: voter.nationalId },
  });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json(publicUser(req.user));
});

app.get("/api/elections", (_req, res) => {
  const elections = [...store.elections.values()].map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startTime: e.startTime,
    endTime: e.endTime,
    status: e.status,
    statusLabel: e.statusLabel,
    candidateCount: e.candidateCount,
    totalVotes: e.totalVotes,
  }));
  res.json({ elections });
});

app.get("/api/elections/:id", (req, res) => {
  const e = store.elections.get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: "Election not found" });
  res.json({
    election: {
      id: e.id,
      title: e.title,
      description: e.description,
      startTime: e.startTime,
      endTime: e.endTime,
      status: e.status,
      statusLabel: e.statusLabel,
      candidateCount: e.candidateCount,
      totalVotes: e.totalVotes,
    },
    candidates: e.candidates,
  });
});

app.get("/api/elections/:id/results", (req, res) => {
  const e = store.elections.get(Number(req.params.id));
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json({
    candidates: e.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      party: c.party,
      votes: c.voteCount,
    })),
    totalVotes: e.totalVotes,
  });
});

app.get("/api/vote/status/:electionId", auth, (req, res) => {
  const electionId = Number(req.params.electionId);
  const already = (req.user.electionsVoted || []).includes(electionId);
  res.json({ electionId, alreadyVoted: already, onChain: already });
});

app.post("/api/vote/permit", auth, (req, res) => {
  if (req.user.eligible === false || req.user.verified === false) {
    return res.status(403).json({ error: "You are not an eligible registered voter" });
  }
  const electionId = Number(req.body?.electionId);
  const e = store.elections.get(electionId);
  if (!e) return res.status(404).json({ error: "Election not found" });
  if (e.status !== 2) return res.status(400).json({ error: "Election is not active" });
  if ((req.user.electionsVoted || []).includes(electionId)) {
    return res.status(409).json({ error: "You have already voted", alreadyVoted: true });
  }
  const nullifier = computeNullifier(req.user.idHash, electionId);
  const key = `${electionId}:${nullifier}`;
  if (store.nullifiers.has(key)) {
    return res.status(409).json({ error: "Nullifier already used", alreadyVoted: true });
  }
  const deadline = Math.floor(Date.now() / 1000) + 600;
  res.json({
    permit: {
      electionId,
      nullifier,
      deadline,
      signature: "0xDEMO",
      mode: "demo",
    },
  });
});

app.post("/api/vote/cast-demo", auth, (req, res) => {
  try {
    if (req.user.eligible === false || req.user.verified === false) {
      return res.status(403).json({ error: "You are not an eligible registered voter" });
    }
    const electionId = Number(req.body?.electionId);
    const candidateId = Number(req.body?.candidateId);
    const e = store.elections.get(electionId);
    if (!e) return res.status(404).json({ error: "Election not found" });
    if (e.status !== 2) return res.status(400).json({ error: "Election is not active" });
    if ((req.user.electionsVoted || []).includes(electionId)) {
      return res.status(409).json({ error: "You have already voted in this election", alreadyVoted: true });
    }
    const cand = e.candidates.find((c) => c.id === candidateId);
    if (!cand) return res.status(400).json({ error: "Invalid candidate" });

    const nullifier = computeNullifier(req.user.idHash, electionId);
    const key = `${electionId}:${nullifier}`;
    if (store.nullifiers.has(key)) {
      return res.status(409).json({ error: "Nullifier already used", alreadyVoted: true });
    }

    store.nullifiers.add(key);
    cand.voteCount += 1;
    e.totalVotes += 1;
    if (!req.user.electionsVoted.includes(electionId)) req.user.electionsVoted.push(electionId);

    const txHash =
      "0x" +
      crypto
        .createHash("sha256")
        .update(`${nullifier}:${candidateId}:${Date.now()}`)
        .digest("hex");

    const event = {
      type: "VoteCast",
      electionId,
      candidateId,
      nullifier,
      caster: "0xDemoCaster000000000000000000000000000001",
      newCandidateTally: cand.voteCount,
      newTotalVotes: e.totalVotes,
      timestamp: Math.floor(Date.now() / 1000),
      txHash,
      blockNumber: e.totalVotes + 1000,
      mode: "demo",
    };
    pushEvent(event);

    res.json({
      ok: true,
      mode: "demo-server-cast",
      txHash,
      blockNumber: event.blockNumber,
      caster: event.caster,
      nullifier,
      results: {
        candidates: e.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          party: c.party,
          votes: c.voteCount,
        })),
        totalVotes: e.totalVotes,
      },
      note: "Demo mode on Vercel: nullifier anti-double-vote enforced in API.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Cast failed" });
  }
});

app.post("/api/vote/confirm", auth, (req, res) => {
  const electionId = Number(req.body?.electionId);
  if (electionId && !req.user.electionsVoted.includes(electionId)) {
    req.user.electionsVoted.push(electionId);
  }
  res.json({ ok: true });
});

app.get("/api/events/recent", (_req, res) => {
  res.json({ events: store.events.slice(0, 50) });
});

app.get("/api/events/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: ${JSON.stringify({ type: "connected", recent: store.events.slice(0, 20), mode: "demo" })}\n\n`);
  setTimeout(() => {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }, 1000);
});

app.get("/api/admin/audit", auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Admin only" });
  res.json({
    log: store.events.slice(0, 50).map((e) => ({
      ts: new Date((e.timestamp || 0) * 1000).toISOString(),
      event: e.type,
      electionId: e.electionId,
      txHash: e.txHash,
    })),
  });
});

app.get("/api/admin/voters", auth, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Admin only" });
  res.json({
    voters: [...store.voters.values()].map((v) => ({
      name: v.name,
      region: v.region,
      isAdmin: v.isAdmin,
      eligible: v.eligible !== false,
      verified: v.verified !== false,
      source: v.source || "seed",
      nationalIdMasked: String(v.nationalId || "").replace(/.(?=.{4})/g, "•"),
      electionsVoted: v.electionsVoted,
      registeredAt: v.registeredAt || null,
    })),
  });
});

export default app;
// deploy bust 2026-08-10T12:54:21+00:00
