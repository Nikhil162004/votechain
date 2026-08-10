/**
 * Shared durable store for Vercel serverless.
 * Primary: GitHub repo JSON file (shared across all instances).
 * Fallback: in-memory (local / if GitHub not configured).
 */
import crypto from "crypto";

const OWNER = process.env.GITHUB_STORE_OWNER || "Nikhil162004";
const REPO = process.env.GITHUB_STORE_REPO || "votechain";
const PATH = process.env.GITHUB_STORE_PATH || "data/election-state.json";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const BRANCH = process.env.GITHUB_STORE_BRANCH || "main";

const mem = globalThis.__votechainPersist || (globalThis.__votechainPersist = { data: null, sha: null });

function defaultState() {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    voters: {}, // idHash -> voter (no plain PIN; pinHash only for registered)
    nullifiers: {}, // `${electionId}:${nullifier}` -> true
    events: [],
    elections: {
      "1": {
        id: 1,
        title: "General Election 2026",
        description:
          "National parliamentary election — identity verified off-chain; ballots use cryptographic nullifiers.",
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
      },
    },
  };
}

function seedDemoVoters(state) {
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
    if (state.voters[idHash]) continue;
    const pin = v.nationalId.slice(-4);
    state.voters[idHash] = {
      idHash,
      nationalId: v.nationalId,
      name: v.name,
      email: v.email,
      region: v.region,
      phone: "",
      isAdmin: !!v.isAdmin,
      pinHash: hashPin(pin, idHash),
      // demo only: keep pin for convenience matching seed accounts
      pin,
      verified: true,
      eligible: true,
      source: v.isAdmin ? "seed-admin" : "seed-demo",
      registeredAt: new Date().toISOString(),
      electionsVoted: [],
    };
  }
  state.DEMO_VOTERS = DEMO;
  return state;
}

export function hashId(nationalId) {
  return crypto.createHash("sha256").update(String(nationalId).trim().toUpperCase()).digest("hex");
}

export function hashPin(pin, idHash) {
  return crypto.createHash("sha256").update(`${idHash}:${String(pin)}`).digest("hex");
}

async function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "votechain-store",
  };
}

export function githubEnabled() {
  return Boolean(TOKEN);
}

/**
 * Load shared state. Always merges demo voters.
 */
export async function loadState() {
  if (!TOKEN) {
    if (!mem.data) {
      mem.data = seedDemoVoters(defaultState());
    }
    return structuredClone(mem.data);
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`;
  try {
    const res = await fetch(url, { headers: await ghHeaders() });
    if (res.status === 404) {
      const fresh = seedDemoVoters(defaultState());
      await saveState(fresh, null);
      return structuredClone(fresh);
    }
    if (!res.ok) {
      const t = await res.text();
      console.error("GitHub load failed", res.status, t);
      if (!mem.data) mem.data = seedDemoVoters(defaultState());
      return structuredClone(mem.data);
    }
    const body = await res.json();
    const json = Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");
    const data = seedDemoVoters(JSON.parse(json));
    mem.data = data;
    mem.sha = body.sha;
    return structuredClone(data);
  } catch (e) {
    console.error("loadState error", e);
    if (!mem.data) mem.data = seedDemoVoters(defaultState());
    return structuredClone(mem.data);
  }
}

/**
 * Save full state. Retries on SHA conflict.
 */
export async function saveState(state, shaHint = mem.sha) {
  state.updatedAt = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  // trim events
  if (Array.isArray(state.events) && state.events.length > 100) {
    state.events = state.events.slice(0, 100);
  }

  if (!TOKEN) {
    mem.data = structuredClone(state);
    return state;
  }

  const content = Buffer.from(JSON.stringify(state, null, 2), "utf8").toString("base64");
  let sha = shaHint;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!sha) {
      // fetch current sha
      try {
        const cur = await fetch(
          `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`,
          { headers: await ghHeaders() }
        );
        if (cur.ok) {
          const j = await cur.json();
          sha = j.sha;
        }
      } catch {
        /* create new */
      }
    }

    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
      method: "PUT",
      headers: await ghHeaders(),
      body: JSON.stringify({
        message: `chore: update election state v${state.version}`,
        content,
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (res.ok) {
      const j = await res.json();
      mem.sha = j.content?.sha || null;
      mem.data = structuredClone(state);
      return state;
    }

    if (res.status === 409 || res.status === 422) {
      // conflict — reload sha and retry
      sha = null;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      continue;
    }

    const t = await res.text();
    console.error("GitHub save failed", res.status, t);
    // keep memory copy anyway
    mem.data = structuredClone(state);
    return state;
  }

  mem.data = structuredClone(state);
  return state;
}

/**
 * Atomic mutate: load → fn(state) → save with retry.
 */
export async function updateState(mutator) {
  for (let i = 0; i < 5; i++) {
    const state = await loadState();
    const sha = mem.sha;
    const result = await mutator(state);
    try {
      await saveState(state, sha);
      return { state, result };
    } catch (e) {
      if (i === 4) throw e;
    }
  }
}
