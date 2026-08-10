/**
 * VoteChain API — Vercel serverless with shared GitHub-backed store
 * Tallies/voters persist across instances → correct live results.
 */
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { ethers } from "ethers";
import { validateRegistration, REGIONS } from "./validation.js";
import {
  loadState,
  saveState,
  hashId,
  hashPin,
  githubEnabled,
} from "./store.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "100kb" }));

// No CDN cache on API — tallies must be fresh
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  next();
});

const JWT_SECRET = process.env.JWT_SECRET || "votechain-vercel-demo-secret-change-me";
const NULLIFIER_PEPPER = process.env.NULLIFIER_PEPPER || "evoting-nullifier-pepper-v1";
const CREDENTIAL_TTL = "365d";

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
  return jwt.sign({ idHash: voter.idHash, isAdmin: !!voter.isAdmin }, JWT_SECRET, {
    expiresIn: "8h",
  });
}

function pinMatches(voter, pin) {
  if (!voter) return false;
  if (voter.pin != null && String(voter.pin) === String(pin)) return true;
  const h = hashPin(pin, voter.idHash);
  return !!(voter.pinHash && voter.pinHash === h);
}

function computeNullifier(idHash, electionId) {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "string"], [idHash, BigInt(electionId), NULLIFIER_PEPPER])
  );
}

function electionPublic(e) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startTime: e.startTime,
    endTime: e.endTime,
    status: e.status,
    statusLabel: e.statusLabel,
    candidateCount: e.candidateCount,
    totalVotes: e.totalVotes,
  };
}

function resultsOf(e) {
  return {
    candidates: e.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      party: c.party,
      votes: c.voteCount,
    })),
    totalVotes: e.totalVotes,
    updatedAt: new Date().toISOString(),
  };
}

function findByEmail(state, email) {
  const e = String(email || "").trim().toLowerCase();
  return Object.values(state.voters).find((v) => String(v.email || "").toLowerCase() === e) || null;
}

function findByPhone(state, phone) {
  const p = String(phone || "").trim();
  if (!p) return null;
  return Object.values(state.voters).find((v) => v.phone && String(v.phone) === p) || null;
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const state = await loadState();
    let voter = state.voters[payload.idHash];

    if (!voter && req.headers["x-voter-credential"]) {
      try {
        const cred = jwt.verify(String(req.headers["x-voter-credential"]), JWT_SECRET);
        if (cred.typ === "voter_credential" && cred.idHash === payload.idHash) {
          voter = {
            idHash: cred.idHash,
            nationalId: cred.nationalId,
            name: cred.name,
            email: cred.email,
            phone: cred.phone || "",
            region: cred.region,
            dob: cred.dob || null,
            isAdmin: !!cred.isAdmin,
            pinHash: cred.pinHash,
            verified: true,
            eligible: true,
            source: "credential-restore",
            registeredAt: new Date().toISOString(),
            electionsVoted: [],
          };
          state.voters[voter.idHash] = voter;
          await saveState(state);
        }
      } catch {
        /* ignore */
      }
    }

    if (!voter) {
      return res.status(401).json({
        error: "Session expired. Please log in again with your Voter ID and PIN.",
        code: "SESSION_STALE",
      });
    }
    req.user = voter;
    req.state = state;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Routes ─────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const state = await loadState();
    res.json({
      ok: true,
      service: "votechain-vercel",
      mode: "shared-store",
      store: githubEnabled() ? "github" : "memory",
      voters: Object.keys(state.voters || {}).length,
      electionVotes: state.elections?.["1"]?.totalVotes ?? 0,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    contractAddress: null,
    chainId: 0,
    mode: "demo-shared",
    store: githubEnabled() ? "github" : "memory",
  });
});

app.get("/api/demo/voters", async (_req, res) => {
  const state = await loadState();
  res.json({
    note: "Demo only — PIN is the last 4 characters of National ID",
    voters: (state.DEMO_VOTERS || []).map((v) => ({
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

app.post("/api/auth/register", async (req, res) => {
  const result = validateRegistration(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ error: result.errors[0], errors: result.errors });
  }
  try {
    const state = await loadState();
    const data = result.data;
    const idHash = hashId(data.nationalId);

    if (state.voters[idHash]) {
      return res.status(409).json({ error: "A voter with this National / Voter ID is already registered" });
    }
    if (findByEmail(state, data.email)) {
      return res.status(409).json({ error: "This email is already registered" });
    }
    if (data.phone && findByPhone(state, data.phone)) {
      return res.status(409).json({ error: "This mobile number is already registered" });
    }

    const pinHash = hashPin(data.pin, idHash);
    const voter = {
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
    state.voters[idHash] = voter;
    state.events.unshift({
      type: "VoterRegistered",
      timestamp: Math.floor(Date.now() / 1000),
      name: data.name,
      region: data.region,
    });
    await saveState(state);

    res.status(201).json({
      ok: true,
      message: "Registration successful. You are eligible to vote.",
      token: issueSession(voter),
      credential: issueCredential(voter, data.pin),
      loginHint: { nationalId: voter.nationalId },
      user: publicUser(voter),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { nationalId, pin, credential } = req.body || {};
  if (!nationalId || !pin) {
    return res.status(400).json({ error: "nationalId and pin are required" });
  }

  try {
    const normalizedId = String(nationalId).trim().toUpperCase();
    const idHash = hashId(normalizedId);
    const state = await loadState();
    let voter = state.voters[idHash];
    let restored = false;

    if (!voter && credential) {
      try {
        const payload = jwt.verify(String(credential), JWT_SECRET);
        if (payload.typ !== "voter_credential") throw new Error("bad typ");
        if (payload.idHash !== idHash && String(payload.nationalId || "").toUpperCase() !== normalizedId) {
          throw new Error("id mismatch");
        }
        if (payload.pinHash !== hashPin(pin, payload.idHash)) {
          return res.status(401).json({ error: "Invalid PIN for this saved account", code: "BAD_PIN" });
        }
        voter = {
          idHash: payload.idHash,
          nationalId: payload.nationalId || normalizedId,
          name: payload.name,
          email: payload.email,
          phone: payload.phone || "",
          region: payload.region,
          dob: payload.dob || null,
          isAdmin: !!payload.isAdmin,
          pin: String(pin),
          pinHash: payload.pinHash,
          verified: true,
          eligible: true,
          source: "credential-restore",
          registeredAt: new Date().toISOString(),
          electionsVoted: [],
        };
        state.voters[voter.idHash] = voter;
        await saveState(state);
        restored = true;
      } catch {
        return res.status(401).json({
          error: "Account not found. Please Register again.",
          code: "NEED_REREGISTER",
        });
      }
    }

    if (!voter) {
      return res.status(401).json({
        error: "Invalid credentials or voter not registered.",
        code: "NOT_FOUND",
        hint: "Demo: VOTER-1002 / 1002",
      });
    }

    if (voter.eligible === false || voter.verified === false) {
      return res.status(403).json({ error: "Your account is not eligible to vote." });
    }
    if (!pinMatches(voter, pin)) {
      return res.status(401).json({ error: "Invalid PIN.", code: "BAD_PIN" });
    }

    if (!voter.pinHash) voter.pinHash = hashPin(pin, voter.idHash);
    voter.pin = String(pin);
    state.voters[voter.idHash] = voter;
    await saveState(state);

    res.json({
      token: issueSession(voter),
      credential: issueCredential(voter, pin),
      restored,
      user: publicUser(voter),
      loginHint: { nationalId: voter.nationalId },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json(publicUser(req.user));
});

app.get("/api/elections", async (_req, res) => {
  const state = await loadState();
  const elections = Object.values(state.elections || {}).map(electionPublic);
  res.json({ elections, updatedAt: state.updatedAt });
});

app.get("/api/elections/:id", async (req, res) => {
  const state = await loadState();
  const e = state.elections[String(req.params.id)];
  if (!e) return res.status(404).json({ error: "Election not found" });
  res.json({
    election: electionPublic(e),
    candidates: e.candidates,
    updatedAt: state.updatedAt,
  });
});

app.get("/api/elections/:id/results", async (req, res) => {
  const state = await loadState();
  const e = state.elections[String(req.params.id)];
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json(resultsOf(e));
});

app.get("/api/vote/status/:electionId", auth, async (req, res) => {
  const electionId = Number(req.params.electionId);
  // reload user from fresh state
  const state = await loadState();
  const voter = state.voters[req.user.idHash] || req.user;
  const already = (voter.electionsVoted || []).includes(electionId);
  const nullifier = computeNullifier(req.user.idHash, electionId);
  const onChain = !!state.nullifiers[`${electionId}:${nullifier}`];
  res.json({ electionId, alreadyVoted: already || onChain, onChain });
});

app.post("/api/vote/permit", auth, async (req, res) => {
  if (req.user.eligible === false) {
    return res.status(403).json({ error: "You are not an eligible registered voter" });
  }
  const electionId = Number(req.body?.electionId);
  const state = await loadState();
  const e = state.elections[String(electionId)];
  if (!e || e.status !== 2) return res.status(400).json({ error: "Election is not active" });
  const voter = state.voters[req.user.idHash];
  if ((voter?.electionsVoted || []).includes(electionId)) {
    return res.status(409).json({ error: "You have already voted", alreadyVoted: true });
  }
  const nullifier = computeNullifier(req.user.idHash, electionId);
  if (state.nullifiers[`${electionId}:${nullifier}`]) {
    return res.status(409).json({ error: "Nullifier already used", alreadyVoted: true });
  }
  res.json({
    permit: {
      electionId,
      nullifier,
      deadline: Math.floor(Date.now() / 1000) + 600,
      signature: "0xDEMO",
      mode: "demo",
    },
  });
});

app.post("/api/vote/cast-demo", auth, async (req, res) => {
  try {
    if (req.user.eligible === false) {
      return res.status(403).json({ error: "You are not an eligible registered voter" });
    }
    const electionId = Number(req.body?.electionId);
    const candidateId = Number(req.body?.candidateId);
    if (!electionId || !candidateId) {
      return res.status(400).json({ error: "electionId and candidateId are required" });
    }

    // Optimistic concurrency loop for accurate tallies
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const state = await loadState();
      const e = state.elections[String(electionId)];
      if (!e) return res.status(404).json({ error: "Election not found" });
      if (e.status !== 2) return res.status(400).json({ error: "Election is not active" });

      const voter = state.voters[req.user.idHash];
      if (!voter) return res.status(401).json({ error: "Voter not found" });

      const nullifier = computeNullifier(req.user.idHash, electionId);
      const nKey = `${electionId}:${nullifier}`;

      if ((voter.electionsVoted || []).includes(electionId) || state.nullifiers[nKey]) {
        return res.status(409).json({
          error: "You have already voted in this election",
          alreadyVoted: true,
          results: resultsOf(e),
        });
      }

      const cand = e.candidates.find((c) => c.id === candidateId);
      if (!cand) return res.status(400).json({ error: "Invalid candidate" });

      state.nullifiers[nKey] = true;
      cand.voteCount = Number(cand.voteCount || 0) + 1;
      e.totalVotes = Number(e.totalVotes || 0) + 1;
      if (!Array.isArray(voter.electionsVoted)) voter.electionsVoted = [];
      voter.electionsVoted.push(electionId);
      state.voters[voter.idHash] = voter;

      const txHash =
        "0x" +
        crypto
          .createHash("sha256")
          .update(`${nullifier}:${candidateId}:${Date.now()}:${attempt}`)
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
        blockNumber: 1000 + e.totalVotes,
        mode: "demo",
      };
      state.events.unshift(event);

      try {
        await saveState(state);
        return res.json({
          ok: true,
          mode: "demo-shared-store",
          txHash,
          blockNumber: event.blockNumber,
          caster: event.caster,
          nullifier,
          results: resultsOf(e),
          election: electionPublic(e),
          candidates: e.candidates,
          note: "Vote saved to shared store — tallies are consistent for all users.",
        });
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
      }
    }
    res.status(500).json({ error: lastError?.message || "Failed to save vote — try again" });
  } catch (err) {
    console.error("cast-demo error", err);
    res.status(500).json({ error: err.message || "Cast failed" });
  }
});

app.post("/api/vote/confirm", auth, async (req, res) => {
  const electionId = Number(req.body?.electionId);
  const state = await loadState();
  const voter = state.voters[req.user.idHash];
  if (voter && electionId && !(voter.electionsVoted || []).includes(electionId)) {
    voter.electionsVoted = [...(voter.electionsVoted || []), electionId];
    state.voters[voter.idHash] = voter;
    await saveState(state);
  }
  res.json({ ok: true });
});

app.get("/api/events/recent", async (_req, res) => {
  const state = await loadState();
  res.json({ events: (state.events || []).filter((e) => e.type === "VoteCast").slice(0, 50) });
});

app.get("/api/events/stream", async (req, res) => {
  const state = await loadState();
  const recent = (state.events || []).filter((e) => e.type === "VoteCast").slice(0, 20);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.write(`data: ${JSON.stringify({ type: "connected", recent, mode: "demo" })}\n\n`);
  setTimeout(() => {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }, 500);
});

app.get("/api/admin/audit", auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Admin only" });
  const state = await loadState();
  res.json({
    log: (state.events || []).slice(0, 50).map((e) => ({
      ts: new Date((e.timestamp || 0) * 1000).toISOString(),
      event: e.type,
      electionId: e.electionId,
      txHash: e.txHash,
    })),
  });
});

app.get("/api/admin/voters", auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Admin only" });
  const state = await loadState();
  res.json({
    voters: Object.values(state.voters || {}).map((v) => ({
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
