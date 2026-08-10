const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // Permit signer: use env or deployer for local demo
  const permitSigner = process.env.PERMIT_SIGNER || deployer.address;
  console.log("Permit signer:", permitSigner);

  const VotingSystem = await hre.ethers.getContractFactory("VotingSystem");
  const voting = await VotingSystem.deploy(permitSigner);
  await voting.waitForDeployment();
  const address = await voting.getAddress();

  console.log("VotingSystem deployed to:", address);

  // Seed a demo election if SEED_DEMO=true (default on local)
  const network = hre.network.name;
  if (network === "localhost" || network === "hardhat" || network === "ganache" || process.env.SEED_DEMO === "true") {
    console.log("\nSeeding demo election...");
    const now = Math.floor(Date.now() / 1000);
    const start = now - 60; // already started
    const end = now + 7 * 24 * 3600; // 7 days

    const tx1 = await voting.createElection(
      "General Election 2026",
      "National parliamentary election — vote for your preferred candidate. Identity is verified off-chain; your ballot remains anonymous on-chain via nullifiers.",
      start,
      end
    );
    await tx1.wait();

    const candidates = [
      ["Aarav Sharma", "Progressive Alliance", "Focus on education, digital infrastructure, and green energy."],
      ["Priya Patel", "Unity Front", "Healthcare for all, rural development, and job creation."],
      ["Rohan Mehta", "Future Party", "Startup ecosystem, tax reform, and transparent governance."],
      ["Ananya Singh", "People First", "Women empowerment, environmental protection, and social justice."],
    ];

    for (const [name, party, manifesto] of candidates) {
      const tx = await voting.addCandidate(1, name, party, manifesto);
      await tx.wait();
      console.log("  + Candidate:", name, `(${party})`);
    }

    const txAct = await voting.activateElection(1);
    await txAct.wait();
    console.log("Election #1 activated.");
  }

  // Write deployment artifact for backend + frontend
  const artifact = {
    address,
    permitSigner,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const outDirs = [
    path.join(__dirname, "..", "deployments"),
    path.join(__dirname, "..", "..", "backend", "config"),
    path.join(__dirname, "..", "..", "frontend", "src", "config"),
  ];

  for (const dir of outDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "deployment.json"), JSON.stringify(artifact, null, 2));
  }

  // Copy ABI
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "VotingSystem.sol",
    "VotingSystem.json"
  );
  const fullArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abiOnly = { abi: fullArtifact.abi };

  for (const dir of outDirs) {
    fs.writeFileSync(path.join(dir, "VotingSystem.json"), JSON.stringify(abiOnly, null, 2));
  }

  // Frontend env hint
  // Empty VITE_API_URL => browser uses same-origin /api (Vite proxy → backend)
  const frontendEnv = `VITE_CONTRACT_ADDRESS=${address}
VITE_CHAIN_ID=${artifact.chainId}
VITE_API_URL=
`;
  fs.writeFileSync(path.join(__dirname, "..", "..", "frontend", ".env.local"), frontendEnv);

  const backendEnv = `PORT=4000
CONTRACT_ADDRESS=${address}
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=${artifact.chainId}
# Private key of permit signer (Hardhat account #0 by default)
PERMIT_SIGNER_KEY=${process.env.PERMIT_SIGNER_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"}
JWT_SECRET=evoting-dev-secret-change-in-production
ADMIN_WALLET=${deployer.address}
CORS_ORIGIN=*
`;
  fs.writeFileSync(path.join(__dirname, "..", "..", "backend", ".env"), backendEnv);

  console.log("\nDeployment artifacts written to backend/config and frontend/src/config");
  console.log("frontend/.env.local and backend/.env updated.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
