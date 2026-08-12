require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const db = require("./db");
const permit = require("./permit");
const chain = require("./chain");
const localElections = require("./localElections");
const { validateRegistration, INDIAN_STATES } = require("./validation");

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "evoting-dev-secret-change-in-production";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(","),
    credentials: true,
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(morgan("dev"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, try again later" },
});

const permitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many permit requests" },
});

// ─── Auth middleware ───────────────────────────────────────────
function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: "Authentication required" });
      req.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const voter = db.getVoter(payload.idHash);
      if (!voter) return res.status(401).json({ error: "Invalid session" });
      req.user = voter;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}

// ─── Health ────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "evoting-backend",
    signer: permit.getSignerAddress(),
    time: new Date().toISOString(),
  });
});

app.get("/api/config", (_req, res) => {
  try {
    const depPath = path.join(__dirname, "..", "config", "deployment.json");
    let deployment = null;
    if (fs.existsSync(depPath)) {
      deployment = JSON.parse(fs.readFileSync(depPath, "utf8"));
    }
    res.json({
      contractAddress: process.env.CONTRACT_ADDRESS || deployment?.address || null,
      chainId: Number(process.env.CHAIN_ID || deployment?.chainId || 31337),
      permitSigner: permit.getSignerAddress() || null,
      domain: permit.getDomain() || null,
      rpcUrl: process.env.PUBLIC_RPC_URL || null,
      mode: "local",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Demo credentials (dev only) ───────────────────────────────
app.get("/api/demo/voters", (_req, res) => {
  res.json({
    note: "Demo only — PIN is the last 4 characters of National ID",
    voters: db.DEMO_VOTERS.map((v) => ({
      nationalId: v.nationalId,
      name: v.name,
      pin: v.nationalId.slice(-4),
      isAdmin: !!v.isAdmin,
    })),
  });
});

// ─── Registration (eligible voters only) ───────────────────────
app.get("/api/auth/regions", (_req, res) => {
  res.json({ regions: INDIAN_STATES });
});

app.post("/api/auth/register", authLimiter, (req, res) => {
  const result = validateRegistration(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ error: result.errors[0], errors: result.errors });
  }
  try {
    const voter = db.registerVoter(result.data);
    const token = jwt.sign(
      { idHash: voter.idHash, isAdmin: false },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.status(201).json({
      ok: true,
      message: "Registration successful. You are eligible to vote.",
      token,
      user: {
        name: voter.name,
        email: voter.email,
        region: voter.region,
        isAdmin: false,
        eligible: true,
        verified: true,
        nationalIdMasked: voter.nationalId.replace(/.(?=.{4})/g, "•"),
        electionsVoted: [],
      },
    });
  } catch (err) {
    const status = err.code && String(err.code).startsWith("DUPLICATE") ? 409 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// ─── Auth ──────────────────────────────────────────────────────
app.post("/api/auth/login", authLimiter, (req, res) => {
  const { nationalId, pin } = req.body || {};
  if (!nationalId || !pin) {
    return res.status(400).json({ error: "nationalId and pin are required" });
  }
  // Distinguish unknown vs not eligible
  const existing = db.findByNationalId(nationalId);
  if (existing && String(pin) === String(existing.pin) && (existing.eligible === false || existing.verified === false)) {
    return res.status(403).json({ error: "Your account is not eligible to vote. Contact the election office." });
  }
  const voter = db.findByCredentials(nationalId, pin);
  if (!voter) {
    db.log("login_failed", { nationalId: String(nationalId).slice(0, 6) + "…" });
    return res.status(401).json({ error: "Invalid credentials or voter not registered" });
  }
  const token = jwt.sign(
    { idHash: voter.idHash, isAdmin: voter.isAdmin },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
  db.log("login_ok", { idHash: voter.idHash.slice(0, 12) });
  res.json({
    token,
    user: {
      name: voter.name,
      email: voter.email,
      region: voter.region,
      isAdmin: voter.isAdmin,
      eligible: voter.eligible !== false,
      verified: voter.verified !== false,
      nationalIdMasked: voter.nationalId.replace(/.(?=.{4})/g, "•"),
      electionsVoted: voter.electionsVoted,
    },
  });
});

app.get("/api/auth/me", auth(true), (req, res) => {
  const v = req.user;
  res.json({
    name: v.name,
    email: v.email,
    region: v.region,
    isAdmin: v.isAdmin,
    eligible: v.eligible !== false,
    verified: v.verified !== false,
    nationalIdMasked: v.nationalId.replace(/.(?=.{4})/g, "•"),
    electionsVoted: v.electionsVoted,
  });
});

// ─── Elections (chain + local admin-created) ───────────────────
app.get("/api/elections", async (_req, res) => {
  let chainList = [];
  try {
    chainList = (await chain.listElections()) || [];
    chainList = chainList.map((e) => ({ ...e, source: "chain" }));
  } catch (err) {
    console.warn("[elections] chain list failed:", err.message);
  }
  const localList = localElections.list().map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startTime: e.startTime,
    endTime: e.endTime,
    status: e.status,
    statusLabel: e.statusLabel,
    candidateCount: e.candidateCount,
    totalVotes: e.totalVotes,
    source: "local",
  }));
  // Prefer showing both; local ids are > 1000 so no clash with chain 1..n
  const elections = [...chainList, ...localList].sort((a, b) => Number(a.id) - Number(b.id));
  res.json({ elections, updatedAt: new Date().toISOString() });
});

app.get("/api/elections/:id", async (req, res) => {
  const id = req.params.id;
  try {
    if (localElections.isLocalId(id)) {
      const e = localElections.get(id);
      if (!e) return res.status(404).json({ error: "Election not found" });
      return res.json({
        election: localElections.publicElection(e),
        candidates: e.candidates || [],
        updatedAt: new Date().toISOString(),
      });
    }
    const election = await chain.getElection(id);
    if (!election) return res.status(404).json({ error: "Election not found" });
    const candidates = await chain.getAllCandidates(id);
    res.json({ election: { ...election, source: "chain" }, candidates });
  } catch (err) {
    // fallback local
    const e = localElections.get(id);
    if (e) {
      return res.json({
        election: localElections.publicElection(e),
        candidates: e.candidates || [],
      });
    }
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/elections/:id/results", async (req, res) => {
  const id = req.params.id;
  try {
    if (localElections.isLocalId(id)) {
      const e = localElections.get(id);
      if (!e) return res.status(404).json({ error: "Not found" });
      return res.json(localElections.resultsOf(e));
    }
    const results = await chain.getResults(id);
    if (!results) return res.status(404).json({ error: "Not found" });
    res.json({ ...results, updatedAt: new Date().toISOString() });
  } catch (err) {
    const e = localElections.get(id);
    if (e) return res.json(localElections.resultsOf(e));
    res.status(502).json({ error: err.message });
  }
});

// ─── Vote permit (identity-gated) ──────────────────────────────
app.post("/api/vote/permit", auth(true), permitLimiter, async (req, res) => {
  try {
    if (req.user.eligible === false || req.user.verified === false) {
      return res.status(403).json({ error: "You are not an eligible registered voter" });
    }
    const { electionId } = req.body || {};
    if (!electionId) return res.status(400).json({ error: "electionId required" });

    const election = await chain.getElection(electionId);
    if (!election) return res.status(404).json({ error: "Election not found on chain" });
    if (election.status !== 2) {
      return res.status(400).json({ error: `Election is not active (status=${election.statusLabel})` });
    }

    let now = Math.floor(Date.now() / 1000);
    try {
      const block = await chain.getProvider().getBlock("latest");
      if (block?.timestamp) now = Number(block.timestamp);
    } catch {
      /* wall clock */
    }
    if (now < election.startTime) return res.status(400).json({ error: "Election has not started" });
    if (now > election.endTime) return res.status(400).json({ error: "Election has ended" });

    // Server-side double-issue guard (nullifier also enforced on-chain)
    if (db.hasVoted(req.user.idHash, electionId)) {
      return res.status(409).json({
        error: "You have already been issued a ballot for this election",
        alreadyVoted: true,
      });
    }

    const nullifier = permit.computeNullifier(req.user.idHash, electionId);

    // Check on-chain nullifier
    const used = await chain.isNullifierUsed(electionId, nullifier);
    if (used) {
      db.markVoted(req.user.idHash, electionId);
      return res.status(409).json({ error: "Nullifier already used on-chain", alreadyVoted: true });
    }

    const ballot = await permit.issueVotePermit(electionId, nullifier, 600);
    db.recordPermit(electionId, nullifier, {
      idHash: req.user.idHash,
      name: req.user.name,
    });
    db.log("permit_issued", {
      electionId: Number(electionId),
      idHash: req.user.idHash.slice(0, 12),
      nullifier: nullifier.slice(0, 18) + "…",
    });

    res.json({
      permit: ballot,
      // Frontend needs these to call castVote
      instructions: {
        method: "castVote",
        args: ["electionId", "candidateId", "nullifier", "deadline", "signature"],
        note: "Choose your candidate in the UI, then submit castVote with this permit. Your identity is NOT sent on-chain.",
      },
    });
  } catch (err) {
    console.error("permit error", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * One-click demo vote: issue permit + cast on-chain via backend wallet.
 * Needed when browser/MetaMask cannot reach the sandbox Hardhat RPC.
 * Still uses real nullifiers + smart contract (not a fake tally).
 */
app.post("/api/vote/cast-demo", auth(true), permitLimiter, async (req, res) => {
  try {
    if (req.user.eligible === false || req.user.verified === false) {
      return res.status(403).json({ error: "You are not an eligible registered voter" });
    }
    const { electionId, candidateId } = req.body || {};
    if (!electionId || !candidateId) {
      return res.status(400).json({ error: "electionId and candidateId are required" });
    }

    // Local admin-created elections (id > 1000)
    if (localElections.isLocalId(electionId)) {
      if (db.hasVoted(req.user.idHash, electionId)) {
        const e = localElections.get(electionId);
        return res.status(409).json({
          error: "You have already voted in this election",
          alreadyVoted: true,
          results: e ? localElections.resultsOf(e) : null,
        });
      }
      try {
        const out = localElections.castVote(electionId, candidateId, req.user.idHash);
        db.markVoted(req.user.idHash, electionId);
        db.log("vote_cast_local", {
          electionId: Number(electionId),
          candidateId: Number(candidateId),
          idHash: req.user.idHash.slice(0, 12),
          txHash: out.txHash,
        });
        return res.json(out);
      } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({
          error: err.message,
          alreadyVoted: !!err.alreadyVoted,
          results: err.results || undefined,
        });
      }
    }

    const election = await chain.getElection(electionId);
    if (!election) return res.status(404).json({ error: "Election not found on chain" });
    if (election.status !== 2) {
      return res.status(400).json({ error: `Election is not active (status=${election.statusLabel})` });
    }

    // Use chain time when available — Hardhat can drift from wall clock in long sessions
    let now = Math.floor(Date.now() / 1000);
    try {
      const provider = chain.getProvider();
      const block = await provider.getBlock("latest");
      if (block?.timestamp) now = Number(block.timestamp);
    } catch {
      /* keep wall clock */
    }
    if (now < election.startTime) return res.status(400).json({ error: "Election has not started" });
    if (now > election.endTime) return res.status(400).json({ error: "Election has ended" });

    if (db.hasVoted(req.user.idHash, electionId)) {
      return res.status(409).json({ error: "You have already voted in this election", alreadyVoted: true });
    }

    const nullifier = permit.computeNullifier(req.user.idHash, electionId);
    const used = await chain.isNullifierUsed(electionId, nullifier);
    if (used) {
      db.markVoted(req.user.idHash, electionId);
      return res.status(409).json({ error: "Nullifier already used on-chain", alreadyVoted: true });
    }

    const ballot = await permit.issueVotePermit(electionId, nullifier, 600);
    db.recordPermit(electionId, nullifier, {
      idHash: req.user.idHash,
      name: req.user.name,
    });

    const receipt = await chain.castVoteOnChain(
      ballot.electionId,
      Number(candidateId),
      ballot.nullifier,
      ballot.deadline,
      ballot.signature
    );

    db.markVoted(req.user.idHash, electionId);
    db.log("vote_cast_demo", {
      electionId: Number(electionId),
      candidateId: Number(candidateId),
      idHash: req.user.idHash.slice(0, 12),
      txHash: receipt.txHash,
    });

    const results = await chain.getResults(electionId);
    res.json({
      ok: true,
      mode: "demo-server-cast",
      txHash: receipt.txHash,
      blockNumber: receipt.blockNumber,
      caster: receipt.caster,
      nullifier: ballot.nullifier,
      results,
      note: "Vote was submitted on-chain by the demo backend wallet. Nullifier still prevents double-voting.",
    });
  } catch (err) {
    console.error("cast-demo error", err);
    let msg = err.reason || err.shortMessage || err.message || "Cast failed";
    if (String(msg).includes("NullifierAlreadyUsed")) {
      db.markVoted(req.user.idHash, req.body?.electionId);
      return res.status(409).json({ error: "Already voted (nullifier used)", alreadyVoted: true });
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * Client confirms vote was mined — mark voter so they can't re-request.
 * (Also safe if skipped: on-chain nullifier still blocks double vote.)
 */
app.post("/api/vote/confirm", auth(true), async (req, res) => {
  const { electionId, txHash } = req.body || {};
  if (!electionId) return res.status(400).json({ error: "electionId required" });
  db.markVoted(req.user.idHash, electionId);
  db.log("vote_confirmed", {
    electionId: Number(electionId),
    idHash: req.user.idHash.slice(0, 12),
    txHash,
  });
  res.json({ ok: true });
});

app.get("/api/vote/status/:electionId", auth(true), async (req, res) => {
  const electionId = req.params.electionId;
  const nullifier = permit.computeNullifier(req.user.idHash, electionId);
  let onChain = false;
  try {
    onChain = await chain.isNullifierUsed(electionId, nullifier);
  } catch {
    /* chain down */
  }
  res.json({
    electionId: Number(electionId),
    alreadyVoted: db.hasVoted(req.user.idHash, electionId) || onChain,
    onChain,
  });
});

// ─── Live tallies via SSE ──────────────────────────────────────
app.get("/api/events/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  chain.addSseClient(res);
  req.on("close", () => chain.removeSseClient(res));
});

app.get("/api/events/recent", (_req, res) => {
  const chainEvents = chain.getRecentVotes() || [];
  const localEvents = localElections.recentVoteEvents(50);
  const events = [...localEvents, ...chainEvents]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, 50);
  res.json({ events });
});

// ─── Admin ─────────────────────────────────────────────────────
app.get("/api/admin/audit", auth(true), adminOnly, (_req, res) => {
  const chainLog = db.getAuditLog(100);
  const localLog = localElections.auditEvents(80).map((e) => ({
    ts: new Date((e.timestamp || 0) * 1000).toISOString(),
    event: e.type,
    electionId: e.electionId,
    txHash: e.txHash,
    title: e.title,
    name: e.name,
    candidateName: e.candidateName,
  }));
  res.json({ log: [...localLog, ...chainLog].slice(0, 150) });
});

app.get("/api/admin/voters", auth(true), adminOnly, (_req, res) => {
  res.json({ voters: db.listVotersPublic() });
});

app.get("/api/admin/elections", auth(true), adminOnly, async (_req, res) => {
  let chainList = [];
  try {
    const list = (await chain.listElections()) || [];
    for (const e of list) {
      let candidates = [];
      try {
        candidates = await chain.getAllCandidates(e.id);
      } catch {
        /* ignore */
      }
      chainList.push({
        ...e,
        source: "chain",
        candidates: candidates.map((c) => ({
          id: c.id,
          name: c.name,
          party: c.party,
          manifesto: c.manifesto,
          voteCount: c.voteCount,
          exists: true,
        })),
      });
    }
  } catch (err) {
    console.warn("[admin/elections] chain failed:", err.message);
  }
  const localList = localElections.list();
  res.json({
    elections: [...chainList, ...localList].sort((a, b) => Number(b.id) - Number(a.id)),
    updatedAt: new Date().toISOString(),
  });
});

app.post("/api/admin/elections", auth(true), adminOnly, (req, res) => {
  try {
    const election = localElections.create(req.body || {}, req.user.name || "admin");
    res.status(201).json({
      ok: true,
      election: { ...localElections.publicElection(election), candidates: [] },
      message: "Election created. Add candidates, then set status to Active when ready.",
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.patch("/api/admin/elections/:id", auth(true), adminOnly, (req, res) => {
  try {
    if (!localElections.isLocalId(req.params.id)) {
      return res.status(400).json({
        error: "On-chain seed elections cannot be edited here. Create a new election (id will be > 1000).",
      });
    }
    const election = localElections.update(req.params.id, req.body || {}, req.user.name || "admin");
    res.json({
      ok: true,
      election: { ...localElections.publicElection(election), candidates: election.candidates },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/admin/elections/:id/candidates", auth(true), adminOnly, (req, res) => {
  try {
    if (!localElections.isLocalId(req.params.id)) {
      return res.status(400).json({
        error: "Cannot add candidates to on-chain seed election from this panel. Create a new local election.",
      });
    }
    const { election, candidate } = localElections.addCandidate(
      req.params.id,
      req.body || {},
      req.user.name || "admin"
    );
    res.status(201).json({
      ok: true,
      candidate,
      election: { ...localElections.publicElection(election), candidates: election.candidates },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete("/api/admin/elections/:id/candidates/:candidateId", auth(true), adminOnly, (req, res) => {
  try {
    if (!localElections.isLocalId(req.params.id)) {
      return res.status(400).json({ error: "Cannot modify on-chain seed election candidates here." });
    }
    const election = localElections.removeCandidate(
      req.params.id,
      req.params.candidateId,
      req.user.name || "admin"
    );
    res.json({
      ok: true,
      election: { ...localElections.publicElection(election), candidates: election.candidates },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete("/api/admin/elections/:id", auth(true), adminOnly, (req, res) => {
  try {
    if (!localElections.isLocalId(req.params.id)) {
      return res.status(400).json({ error: "Cannot delete on-chain seed election from this panel." });
    }
    localElections.removeElection(req.params.id, req.user.name || "admin");
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/admin/reload", auth(true), adminOnly, (_req, res) => {
  permit.reloadDomain();
  chain.init();
  chain.startEventListener();
  res.json({ ok: true, domain: permit.getDomain() });
});

// ─── Boot ──────────────────────────────────────────────────────
function boot() {
  try {
    permit.init();
  } catch (e) {
    console.error("Permit init failed:", e.message);
  }
  try {
    chain.init();
    chain.startEventListener();
  } catch (e) {
    console.error("Chain init failed:", e.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🗳️  E-Voting backend listening on http://0.0.0.0:${PORT}`);
    console.log(`    Health: http://localhost:${PORT}/api/health\n`);
  });
}

boot();
