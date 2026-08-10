import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import { formatTs } from "../lib/contract";
import { useAuth } from "../context/AuthContext";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [elections, setElections] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.elections().then((d) => setElections(d.elections || [])).catch(() => {});
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const active = elections.filter((e) => e.status === 2);
  const totalVotes = elections.reduce((s, e) => s + (e.totalVotes || 0), 0);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">⬡ Blockchain-secured democracy</div>
            <h1>
              Vote with <span>cryptographic proof</span>, stay anonymous
            </h1>
            <p className="hero-lead">
              VoteChain verifies your identity off-chain, then lets you cast a tamper-proof ballot
              on Ethereum. Nullifiers prevent double-voting without revealing who you are.
            </p>
            <div className="hero-actions">
              <Link to="/elections" className="btn btn-primary btn-lg">
                View Elections
              </Link>
              {!isAuthenticated ? (
                <Link to="/login" className="btn btn-secondary btn-lg">
                  Voter Login
                </Link>
              ) : (
                <Link to="/live" className="btn btn-secondary btn-lg">
                  Live Tallies
                </Link>
              )}
            </div>
            <div className="feature-pills">
              <span className="pill">EIP-712 vote permits</span>
              <span className="pill">Nullifier anti-double-vote</span>
              <span className="pill">On-chain tallies</span>
              <span className="pill">Real-time event audit</span>
            </div>
          </div>

          <div className="card security-panel">
            <h3 style={{ marginBottom: "0.75rem" }}>How your ballot stays private</h3>
            <div className="steps">
              <div className="step done">
                <div className="step-num">1</div>
                <div>
                  <h4>Identity check</h4>
                  <p>Backend verifies National ID + PIN. Never written on-chain.</p>
                </div>
              </div>
              <div className="step done">
                <div className="step-num">2</div>
                <div>
                  <h4>Nullifier + permit</h4>
                  <p>Server signs an EIP-712 permit bound to a one-time nullifier.</p>
                </div>
              </div>
              <div className="step active">
                <div className="step-num">3</div>
                <div>
                  <h4>Cast from any wallet</h4>
                  <p>Only nullifier, choice, and tally hit the smart contract.</p>
                </div>
              </div>
            </div>
            <div className="mono text-sm text-muted mt-2">
              API {health?.ok ? "● online" : "○ offline"}
              {health?.signer ? ` · signer ${health.signer.slice(0, 8)}…` : ""}
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{elections.length}</div>
            <div className="stat-label">Elections on-chain</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{active.length}</div>
            <div className="stat-label">Active now</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalVotes}</div>
            <div className="stat-label">Ballots cast</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">0</div>
            <div className="stat-label">Identity leaks</div>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="section-header">
            <div>
              <h2>Open elections</h2>
              <p>Published directly from the VotingSystem smart contract</p>
            </div>
            <Link to="/elections" className="btn btn-secondary btn-sm">
              See all
            </Link>
          </div>

          {!elections.length ? (
            <div className="card empty">
              No elections found. Start Hardhat, deploy the contract, and refresh.
            </div>
          ) : (
            <div className="grid-2">
              {elections.slice(0, 4).map((e) => (
                <Link
                  key={e.id}
                  to={`/elections/${e.id}`}
                  className="card card-hover election-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <StatusBadge status={e.status} />
                  <h3>{e.title}</h3>
                  <p>{e.description}</p>
                  <div className="meta-row">
                    <span>{e.candidateCount} candidates</span>
                    <span>{e.totalVotes} votes</span>
                    <span>ends {formatTs(e.endTime)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-header">
            <div>
              <h2>Built for integrity</h2>
              <p>Three layers working together</p>
            </div>
          </div>
          <div className="how-grid">
            <div className="card how-card">
              <div className="icon">🪪</div>
              <h3>Identity service</h3>
              <p>
                Node.js verifies eligible voters and issues short-lived EIP-712 permits. Credentials
                never touch the blockchain.
              </p>
            </div>
            <div className="card how-card">
              <div className="icon">📜</div>
              <h3>Smart contract</h3>
              <p>
                Solidity enforces one nullifier per election, tallies votes, and emits audited
                VoteCast events in real time.
              </p>
            </div>
            <div className="card how-card">
              <div className="icon">⚡</div>
              <h3>Transparent UI</h3>
              <p>
                React + Ethers.js lets anyone watch tallies update from chain events — no trusted
                recount required.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
