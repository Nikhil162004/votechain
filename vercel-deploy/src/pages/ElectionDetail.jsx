import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useWeb3 } from "../context/Web3Context";
import StatusBadge from "../components/StatusBadge";
import ResultsChart from "../components/ResultsChart";
import LiveFeed from "../components/LiveFeed";
import {
  formatTs,
  getWriteContract,
  partyColor,
  ensureChain,
} from "../lib/contract";

const STEPS = ["Authenticate", "Select candidate", "Cast on-chain vote", "Confirmed"];

export default function ElectionDetail() {
  const { id } = useParams();
  const { isAuthenticated, user, refresh } = useAuth();
  const { account, connect, contractAddress, targetChainId, wrongNetwork, hasWallet } = useWeb3();

  const [election, setElection] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [step, setStep] = useState(0);
  const [showWalletPath, setShowWalletPath] = useState(false);
  const [permit, setPermit] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.election(id);
      setElection(data.election);
      setCandidates(data.candidates || []);
      const r = await api.results(id);
      setResults(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStep(0);
      return;
    }
    setStep(1);
    api
      .voteStatus(id)
      .then((s) => {
        if (s.alreadyVoted) {
          setAlreadyVoted(true);
          setStep(3);
        }
      })
      .catch(() => {});
  }, [isAuthenticated, id]);

  useEffect(() => {
    if (isAuthenticated && selected && !alreadyVoted) setStep((s) => Math.max(s, 2));
  }, [isAuthenticated, selected, alreadyVoted]);

  const castDemoVote = async () => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (!isAuthenticated) throw new Error("Login required");
      if (!selected) throw new Error("Select a candidate first");

      setInfo("Verifying identity, issuing nullifier permit, and submitting on-chain…");
      const data = await api.castDemo(Number(id), selected);

      setTxHash(data.txHash);
      setStep(3);
      setAlreadyVoted(true);
      setInfo(
        `Vote confirmed on-chain! Tx ${data.txHash.slice(0, 12)}… · nullifier burned for this election.`
      );
      if (data.results) setResults(data.results);
      await refresh().catch(() => {});
      await load();
    } catch (e) {
      console.error(e);
      if (e.data?.alreadyVoted) {
        setAlreadyVoted(true);
        setStep(3);
      }
      setError(e.message || "Vote failed");
    } finally {
      setBusy(false);
    }
  };

  const requestPermit = async () => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (!isAuthenticated) throw new Error("Login required");
      const data = await api.requestPermit(Number(id));
      setPermit(data.permit);
      setInfo("Ballot permit issued. Confirm the transaction in MetaMask.");
    } catch (e) {
      if (e.data?.alreadyVoted) {
        setAlreadyVoted(true);
        setStep(3);
      }
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const castWithWallet = async () => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (!selected) throw new Error("Select a candidate first");
      if (!permit) throw new Error("Request a ballot permit first");
      if (!account) await connect();
      if (wrongNetwork) await ensureChain(targetChainId);

      const contract = await getWriteContract(contractAddress);
      setInfo("Confirm the transaction in your wallet…");

      const tx = await contract.castVote(
        permit.electionId,
        selected,
        permit.nullifier,
        permit.deadline,
        permit.signature
      );
      setInfo(`Submitted ${tx.hash.slice(0, 10)}… waiting for confirmation`);
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setStep(3);
      setAlreadyVoted(true);
      setInfo("Vote confirmed on-chain via your wallet.");

      try {
        await api.confirmVote(Number(id), receipt.hash);
        await refresh();
      } catch {
        /* non-fatal */
      }
      await load();
      setPermit(null);
    } catch (e) {
      console.error(e);
      let msg = e.reason || e.shortMessage || e.message || "Transaction failed";
      if (msg.includes("user rejected") || e.code === "ACTION_REJECTED") {
        msg = "Transaction rejected in wallet";
      }
      if (msg.includes("could not detect network") || msg.includes("Failed to fetch")) {
        msg =
          "MetaMask cannot reach the local Hardhat chain from this environment. Use the one-click Cast Vote button instead.";
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="empty">Loading election…</div>
      </div>
    );
  }

  if (!election) {
    return (
      <div className="container">
        <div className="alert alert-error">{error || "Election not found"}</div>
        <Link to="/elections">← Back</Link>
      </div>
    );
  }

  const canVote = election.status === 2 && !alreadyVoted;
  const selectedCandidate = candidates.find((c) => c.id === selected);

  return (
    <div className="container">
      <div className="page-title">
        <div className="flex-between">
          <div>
            <div style={{ marginBottom: 8 }}>
              <StatusBadge status={election.status} />
              <span className="mono text-muted" style={{ marginLeft: 8 }}>
                Election #{election.id}
              </span>
            </div>
            <h1>{election.title}</h1>
            <p>{election.description}</p>
          </div>
        </div>
        <div className="meta-row" style={{ marginTop: 12 }}>
          <span>Start {formatTs(election.startTime)}</span>
          <span>End {formatTs(election.endTime)}</span>
          <span>{election.totalVotes} votes cast</span>
        </div>
      </div>

      <section className="section">
        <div className="grid-2">
          <div>
            {error && <div className="alert alert-error">{error}</div>}
            {info && <div className="alert alert-info">{info}</div>}
            {alreadyVoted && (
              <div className="alert alert-success">
                You have already voted in this election
                {txHash ? (
                  <>
                    . Tx <span className="mono">{txHash.slice(0, 18)}…</span>
                  </>
                ) : (
                  "."
                )}
              </div>
            )}

            <div className="card mb-2">
              <h3 style={{ marginBottom: "0.75rem" }}>Voting progress</h3>
              <div className="steps">
                {STEPS.map((label, i) => (
                  <div
                    key={label}
                    className={`step${step > i ? " done" : ""}${step === i ? " active" : ""}`}
                  >
                    <div className="step-num">{step > i ? "✓" : i + 1}</div>
                    <div>
                      <h4>{label}</h4>
                    </div>
                  </div>
                ))}
              </div>

              {!isAuthenticated && canVote && (
                <Link to="/login" className="btn btn-primary btn-block mt-2">
                  Login to vote
                </Link>
              )}

              {isAuthenticated && canVote && (
                <>
                  <div className="alert alert-info mt-2" style={{ marginBottom: 0 }}>
                    <strong>One-click demo vote</strong> — identity is verified, a nullifier permit is
                    signed, and the ballot is submitted to the smart contract. No MetaMask needed in
                    this cloud sandbox.
                  </div>

                  <button
                    className="btn btn-primary btn-block btn-lg mt-2"
                    onClick={castDemoVote}
                    disabled={busy || !selected}
                  >
                    {busy ? (
                      <span className="spinner" />
                    ) : selectedCandidate ? (
                      `Cast vote for ${selectedCandidate.name}`
                    ) : (
                      "Select a candidate below"
                    )}
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-block mt-1"
                    onClick={() => setShowWalletPath((v) => !v)}
                  >
                    {showWalletPath ? "Hide" : "Advanced"}: cast with MetaMask wallet
                  </button>

                  {showWalletPath && (
                    <div className="mt-2" style={{ display: "grid", gap: "0.5rem" }}>
                      <p className="text-sm text-muted">
                        Requires MetaMask on Hardhat Local (chainId 31337, RPC http://127.0.0.1:8545).
                        This usually only works when you run the stack on your own machine.
                      </p>
                      {!account ? (
                        <button
                          className="btn btn-secondary btn-block"
                          onClick={() => connect().catch((e) => setError(e.message))}
                          disabled={!hasWallet || busy}
                        >
                          {hasWallet ? "Connect wallet" : "No wallet detected"}
                        </button>
                      ) : !permit ? (
                        <button className="btn btn-secondary btn-block" onClick={requestPermit} disabled={busy}>
                          Get permit + use wallet
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary btn-block"
                          onClick={castWithWallet}
                          disabled={busy || !selected}
                        >
                          Submit via MetaMask
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {user && (
                <p className="text-sm text-muted mt-2">
                  Signed in as <strong>{user.name}</strong> ({user.nationalIdMasked}) · {user.region}
                </p>
              )}
            </div>

            <h2 style={{ fontSize: "1.2rem", marginBottom: "0.85rem" }}>Candidates</h2>
            <div style={{ display: "grid", gap: "0.85rem" }}>
              {candidates.map((c, i) => (
                <div
                  key={c.id}
                  className={`card candidate-card${selected === c.id ? " selected" : ""}`}
                  onClick={() => canVote && !alreadyVoted && setSelected(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && canVote && setSelected(c.id)}
                >
                  <div className="candidate-head">
                    <div className="avatar" style={{ background: partyColor(i) }}>
                      {c.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h3>{c.name}</h3>
                      <div className="party-tag">{c.party}</div>
                      <p className="manifesto">{c.manifesto}</p>
                      <div className="vote-count">
                        On-chain votes: <strong>{c.voteCount}</strong>
                        {selected === c.id && canVote && (
                          <span style={{ color: "var(--primary-hover)", marginLeft: 8 }}>✓ Selected</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
            <div className="card">
              <ResultsChart
                candidates={
                  results?.candidates ||
                  candidates.map((c) => ({
                    id: c.id,
                    name: c.name,
                    party: c.party,
                    votes: c.voteCount,
                  }))
                }
                totalVotes={results?.totalVotes ?? election.totalVotes}
              />
              <button className="btn btn-ghost btn-sm mt-2" onClick={load}>
                Refresh tallies
              </button>
            </div>
            <LiveFeed electionId={election.id} />
          </div>
        </div>
      </section>
    </div>
  );
}
