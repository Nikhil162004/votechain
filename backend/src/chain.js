const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

let provider;
let contract;
let writeContract = null;
let casterWallet = null;

function loadAbi() {
  const candidates = [
    path.join(__dirname, "..", "config", "VotingSystem.json"),
    path.join(__dirname, "..", "..", "contracts", "artifacts", "contracts", "VotingSystem.sol", "VotingSystem.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j.abi || j;
    }
  }
  return null;
}

function loadDeployment() {
  const p = path.join(__dirname, "..", "config", "deployment.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  return null;
}

function init() {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  provider = new ethers.JsonRpcProvider(rpc);

  const dep = loadDeployment();
  const address = process.env.CONTRACT_ADDRESS || dep?.address;
  const abi = loadAbi();

  if (!address || !abi) {
    console.warn("[chain] Contract not deployed yet — chain reads disabled until deploy");
    return null;
  }

  contract = new ethers.Contract(address, abi, provider);

  // Demo caster wallet — submits castVote txs so UI works without MetaMask
  // Default: Hardhat account #1 (not the deployer/permit signer)
  const casterKey =
    process.env.DEMO_CASTER_KEY ||
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  try {
    casterWallet = new ethers.Wallet(casterKey, provider);
    writeContract = new ethers.Contract(address, abi, casterWallet);
    console.log("[chain] Demo caster wallet:", casterWallet.address);
  } catch (e) {
    console.warn("[chain] Demo caster wallet not configured:", e.message);
  }

  console.log("[chain] Connected to", address, "via", rpc);
  return contract;
}

/**
 * Submit castVote on-chain using the backend demo caster wallet.
 * Used when the browser cannot reach the local Hardhat RPC (cloud previews).
 */
async function castVoteOnChain(electionId, candidateId, nullifier, deadline, signature) {
  if (!writeContract) {
    init();
  }
  if (!writeContract) {
    throw new Error("Demo caster wallet not available");
  }
  const tx = await writeContract.castVote(
    electionId,
    candidateId,
    nullifier,
    deadline,
    signature
  );
  const receipt = await tx.wait();
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    caster: casterWallet.address,
  };
}

function getContract() {
  if (!contract) init();
  return contract;
}

function getProvider() {
  if (!provider) init();
  return provider;
}

async function getElection(electionId) {
  const c = getContract();
  if (!c) return null;
  const e = await c.getElection(electionId);
  return {
    id: Number(e.id),
    title: e.title,
    description: e.description,
    startTime: Number(e.startTime),
    endTime: Number(e.endTime),
    status: Number(e.status),
    statusLabel: ["Draft", "Registration", "Active", "Ended", "Cancelled"][Number(e.status)],
    candidateCount: Number(e.candidateCount),
    totalVotes: Number(e.totalVotes),
  };
}

async function getResults(electionId) {
  const c = getContract();
  if (!c) return null;
  const r = await c.getResults(electionId);
  const candidates = [];
  for (let i = 0; i < r.candidateIds.length; i++) {
    candidates.push({
      id: Number(r.candidateIds[i]),
      name: r.names[i],
      party: r.parties[i],
      votes: Number(r.votes[i]),
    });
  }
  return { candidates, totalVotes: Number(r.totalVotes) };
}

async function getAllCandidates(electionId) {
  const c = getContract();
  if (!c) return [];
  const list = await c.getAllCandidates(electionId);
  return list.map((x) => ({
    id: Number(x.id),
    name: x.name,
    party: x.party,
    manifesto: x.manifesto,
    voteCount: Number(x.voteCount),
    exists: x.exists,
  }));
}

async function isNullifierUsed(electionId, nullifier) {
  const c = getContract();
  if (!c) return false;
  return c.isNullifierUsed(electionId, nullifier);
}

async function getElectionCount() {
  const c = getContract();
  if (!c) return 0;
  return Number(await c.electionCount());
}

async function listElections() {
  const count = await getElectionCount();
  const out = [];
  for (let i = 1; i <= count; i++) {
    try {
      out.push(await getElection(i));
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Subscribe to VoteCast events and keep a live buffer for SSE clients.
 */
const recentVotes = [];
const sseClients = new Set();

function startEventListener() {
  const c = getContract();
  if (!c) {
    console.warn("[chain] No contract — event listener not started");
    return;
  }

  c.on("VoteCast", (electionId, candidateId, nullifier, caster, newCandidateTally, newTotalVotes, timestamp, event) => {
    const payload = {
      type: "VoteCast",
      electionId: Number(electionId),
      candidateId: Number(candidateId),
      nullifier,
      caster,
      newCandidateTally: Number(newCandidateTally),
      newTotalVotes: Number(newTotalVotes),
      timestamp: Number(timestamp),
      txHash: event.log?.transactionHash,
      blockNumber: event.log?.blockNumber,
    };
    recentVotes.unshift(payload);
    if (recentVotes.length > 200) recentVotes.pop();
    broadcast(payload);
    console.log("[chain] VoteCast", payload);
  });

  c.on("ElectionStatusChanged", (electionId, oldStatus, newStatus) => {
    const payload = {
      type: "ElectionStatusChanged",
      electionId: Number(electionId),
      oldStatus: Number(oldStatus),
      newStatus: Number(newStatus),
    };
    broadcast(payload);
  });

  c.on("TallySnapshot", (electionId, totalVotes, timestamp) => {
    broadcast({
      type: "TallySnapshot",
      electionId: Number(electionId),
      totalVotes: Number(totalVotes),
      timestamp: Number(timestamp),
    });
  });

  console.log("[chain] Event listeners attached");
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

function addSseClient(res) {
  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: "connected", recent: recentVotes.slice(0, 20) })}\n\n`);
}

function removeSseClient(res) {
  sseClients.delete(res);
}

function getRecentVotes() {
  return recentVotes;
}

module.exports = {
  init,
  getContract,
  getProvider,
  getElection,
  getResults,
  getAllCandidates,
  isNullifierUsed,
  getElectionCount,
  listElections,
  castVoteOnChain,
  startEventListener,
  addSseClient,
  removeSseClient,
  getRecentVotes,
};
