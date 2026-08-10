# VoteChain — Decentralized E-Voting with Identity Verification

Tamper-resistant voting demo:

- **Off-chain identity** (register / login / eligibility checks)
- **Nullifier-based double-vote prevention**
- **On-chain tallies** via Solidity `VotingSystem` (local Hardhat)
- **Vercel demo mode** (serverless API + React UI) for public testing without MetaMask

## Live demo

- **Vercel:** https://votechain-demo.vercel.app  
- Register a voter → login with **Voter ID + PIN** → cast vote  
- Demo accounts: `VOTER-1001` / `1001`, … `VOTER-1005` / `1005`, admin `ADMIN-0001` / `0001`

## Monorepo layout

```
decentralized-evoting/
├── contracts/       # Solidity + Hardhat (VotingSystem.sol)
├── backend/         # Express identity + EIP-712 permit service
├── frontend/        # React + Vite + Ethers UI
├── vercel-deploy/   # Vercel-ready frontend + /api serverless demo
└── README.md
```

## Local full stack (real chain)

### 1. Install

```bash
cd contracts && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

### 2. Chain + deploy

```bash
# Terminal 1
cd contracts && npx hardhat node

# Terminal 2
cd contracts && npx hardhat run scripts/deploy.js --network localhost
```

### 3. API + UI

```bash
# Terminal 3
cd backend && npm run dev

# Terminal 4
cd frontend && npm run dev
```

Open http://localhost:5173

### Tests

```bash
cd contracts && npx hardhat test
```

## Vercel deploy package

```bash
cd vercel-deploy
npm install
npm run build
npx vercel --prod
```

Demo mode stores tallies/voters in serverless memory and restores registered logins via a browser-saved credential JWT after cold starts. For production, use a database + Sepolia/mainnet RPC.

## Security model (summary)

1. Register/login verifies eligibility (age 18+, unique ID/email/phone, declarations).
2. Backend derives `nullifier = keccak256(idHash ‖ electionId ‖ pepper)`.
3. EIP-712 permit (local) or demo cast API (Vercel) submits the ballot.
4. Nullifier can be used only once per election.

## License

MIT
