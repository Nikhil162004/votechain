import { useWeb3 } from "../context/Web3Context";

export default function HowItWorks() {
  const { contractAddress, targetChainId } = useWeb3();

  return (
    <div className="container">
      <div className="page-title">
        <h1>Security model</h1>
        <p>How VoteChain prevents double-voting while preserving anonymity</p>
      </div>

      <section className="section">
        <div className="how-grid mb-2">
          <div className="card how-card">
            <div className="icon">1️⃣</div>
            <h3>Off-chain identity</h3>
            <p>
              A Node.js service checks voter credentials against an electoral roll. It never
              publishes names, IDs, or wallet links to the blockchain.
            </p>
          </div>
          <div className="card how-card">
            <div className="icon">2️⃣</div>
            <h3>Nullifier derivation</h3>
            <p>
              <code className="mono">nullifier = keccak256(idHash ‖ electionId ‖ pepper)</code>
              <br />
              Same voter + election ⇒ same nullifier. Different elections ⇒ fresh nullifiers.
            </p>
          </div>
          <div className="card how-card">
            <div className="icon">3️⃣</div>
            <h3>EIP-712 permit</h3>
            <p>
              The backend signs <code className="mono">VotePermit(electionId, nullifier, deadline)</code>{" "}
              with a trusted key configured as <code className="mono">permitSigner</code> on the
              contract.
            </p>
          </div>
          <div className="card how-card">
            <div className="icon">4️⃣</div>
            <h3>Anonymous cast</h3>
            <p>
              Any wallet submits <code className="mono">castVote</code>. The contract verifies the
              signature, burns the nullifier, increments tallies, and emits{" "}
              <code className="mono">VoteCast</code>.
            </p>
          </div>
          <div className="card how-card">
            <div className="icon">5️⃣</div>
            <h3>Double-vote blocked</h3>
            <p>
              Reusing a nullifier reverts with <code className="mono">NullifierAlreadyUsed</code>.
              Backend also refuses a second permit after confirmation.
            </p>
          </div>
          <div className="card how-card">
            <div className="icon">6️⃣</div>
            <h3>Public audit</h3>
            <p>
              Tallies and events are readable by anyone. Live UI subscribes via SSE mirrored from
              contract logs — no private recount database required.
            </p>
          </div>
        </div>

        <div className="card security-panel mt-2">
          <h3 style={{ marginBottom: "0.75rem" }}>Threat model (demo scope)</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Guarantee</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Integrity of tally</td>
                  <td>On-chain</td>
                  <td>Smart contract is source of truth</td>
                </tr>
                <tr>
                  <td>One-person-one-vote</td>
                  <td>Nullifier + permit</td>
                  <td>Depends on honest identity issuer</td>
                </tr>
                <tr>
                  <td>Ballot secrecy</td>
                  <td>Unlinkable nullifier</td>
                  <td>Issuer could collude; ZK upgrade path exists</td>
                </tr>
                <tr>
                  <td>Coercion resistance</td>
                  <td>Partial</td>
                  <td>Voter can use a fresh wallet; receipt-freeness limited</td>
                </tr>
                <tr>
                  <td>Availability</td>
                  <td>Chain + API</td>
                  <td>Votes need chain liveness; permits need API</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card mt-2">
          <h3 style={{ marginBottom: "0.5rem" }}>Deployment</h3>
          <p className="text-muted text-sm mb-2">
            Current frontend configuration (updated automatically on deploy):
          </p>
          <div className="mono text-sm">
            <div>contract: {contractAddress || "not deployed"}</div>
            <div>chainId: {targetChainId}</div>
          </div>
          <div className="divider" />
          <pre
            className="mono text-sm"
            style={{
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.25)",
              padding: "1rem",
              borderRadius: 10,
              color: "var(--text-muted)",
            }}
          >{`# Terminal 1 — local chain
cd contracts && npx hardhat node

# Terminal 2 — deploy + seed demo election
cd contracts && npx hardhat run scripts/deploy.js --network localhost

# Terminal 3 — identity / permit API
cd backend && npm run dev

# Terminal 4 — React app
cd frontend && npm run dev`}</pre>
        </div>

        <div className="card mt-2">
          <h3 style={{ marginBottom: "0.5rem" }}>Tech stack</h3>
          <div className="feature-pills">
            <span className="pill">Solidity 0.8.24</span>
            <span className="pill">OpenZeppelin ECDSA</span>
            <span className="pill">Hardhat</span>
            <span className="pill">Ethers v6</span>
            <span className="pill">React + Vite</span>
            <span className="pill">Express + JWT</span>
            <span className="pill">EIP-712</span>
            <span className="pill">SSE live feed</span>
            <span className="pill">Ganache / Sepolia ready</span>
          </div>
        </div>
      </section>
    </div>
  );
}
