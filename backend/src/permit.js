const { ethers } = require("ethers");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

let wallet;
let chainId;
let contractAddress;
let domain;

const VOTE_PERMIT_TYPES = {
  VotePermit: [
    { name: "electionId", type: "uint256" },
    { name: "nullifier", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

function loadDeployment() {
  const candidates = [
    path.join(__dirname, "..", "config", "deployment.json"),
    path.join(__dirname, "..", "..", "contracts", "deployments", "deployment.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  }
  return null;
}

function init() {
  const key = process.env.PERMIT_SIGNER_KEY;
  if (!key) {
    throw new Error("PERMIT_SIGNER_KEY is required");
  }
  wallet = new ethers.Wallet(key);

  const dep = loadDeployment();
  contractAddress = process.env.CONTRACT_ADDRESS || dep?.address;
  chainId = Number(process.env.CHAIN_ID || dep?.chainId || 31337);

  if (!contractAddress) {
    console.warn("[permit] CONTRACT_ADDRESS not set — permits will use placeholder until deploy");
    contractAddress = "0x0000000000000000000000000000000000000001";
  }

  domain = {
    name: "VotingSystem",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };

  console.log("[permit] Signer address:", wallet.address);
  console.log("[permit] Domain:", domain);
  return { signerAddress: wallet.address, domain };
}

function getSignerAddress() {
  return wallet?.address;
}

function getDomain() {
  return domain;
}

/**
 * Nullifier = keccak256(nationalIdHash || electionId || serverPepper)
 * Same voter + same election => same nullifier (double-vote blocked).
 * Different elections => different nullifiers.
 * On-chain observers cannot reverse to national ID.
 */
function computeNullifier(nationalIdHash, electionId) {
  const pepper = process.env.NULLIFIER_PEPPER || "evoting-nullifier-pepper-v1";
  const material = ethers.solidityPacked(
    ["string", "uint256", "string"],
    [nationalIdHash, BigInt(electionId), pepper]
  );
  return ethers.keccak256(material);
}

/**
 * Alternative nullifier from a client-supplied secret commitment (optional advanced path)
 */
function computeNullifierFromSecret(secret, electionId) {
  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint256"], [secret, BigInt(electionId)])
  );
}

async function issueVotePermit(electionId, nullifier, ttlSeconds = 600) {
  if (!wallet) init();
  const deadline = Math.floor(Date.now() / 1000) + ttlSeconds;
  const value = {
    electionId: BigInt(electionId),
    nullifier,
    deadline: BigInt(deadline),
  };
  const signature = await wallet.signTypedData(domain, VOTE_PERMIT_TYPES, value);
  return {
    electionId: Number(electionId),
    nullifier,
    deadline,
    signature,
    domain,
    types: VOTE_PERMIT_TYPES,
  };
}

function reloadDomain() {
  const dep = loadDeployment();
  if (dep?.address) {
    contractAddress = process.env.CONTRACT_ADDRESS || dep.address;
    chainId = Number(process.env.CHAIN_ID || dep.chainId || chainId);
    domain = {
      name: "VotingSystem",
      version: "1",
      chainId,
      verifyingContract: contractAddress,
    };
    console.log("[permit] Domain reloaded:", domain);
  }
}

module.exports = {
  init,
  getSignerAddress,
  getDomain,
  computeNullifier,
  computeNullifierFromSecret,
  issueVotePermit,
  reloadDomain,
  VOTE_PERMIT_TYPES,
};
