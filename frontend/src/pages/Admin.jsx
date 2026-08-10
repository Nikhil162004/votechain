import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";

const emptyElection = {
  title: "",
  description: "",
  startLocal: "",
  endLocal: "",
  status: 1,
};

const emptyCandidate = {
  name: "",
  party: "",
  manifesto: "",
};

function toLocalInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultTimes() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return { startLocal: toLocalInputValue(start), endLocal: toLocalInputValue(end) };
}

export default function Admin() {
  const { isAdmin, isAuthenticated, user } = useAuth();
  const [audit, setAudit] = useState([]);
  const [voters, setVoters] = useState([]);
  const [elections, setElections] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [electionForm, setElectionForm] = useState({ ...emptyElection, ...defaultTimes() });
  const [candidateForms, setCandidateForms] = useState({}); // electionId -> form
  const [tab, setTab] = useState("elections"); // elections | voters | audit

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setError("");
    try {
      const [a, v, e] = await Promise.all([
        api.adminAudit(),
        api.adminVoters(),
        api.adminElections(),
      ]);
      setAudit(a.log || []);
      setVoters(v.voters || []);
      setElections(e.elections || []);
    } catch (err) {
      setError(err.message);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const setEF = (key) => (ev) => setElectionForm((f) => ({ ...f, [key]: ev.target.value }));

  const createElection = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const payload = {
        title: electionForm.title.trim(),
        description: electionForm.description.trim(),
        startTime: electionForm.startLocal ? new Date(electionForm.startLocal).toISOString() : undefined,
        endTime: electionForm.endLocal ? new Date(electionForm.endLocal).toISOString() : undefined,
        status: Number(electionForm.status),
      };
      const res = await api.adminCreateElection(payload);
      setInfo(res.message || `Election #${res.election?.id} created`);
      setElectionForm({ ...emptyElection, ...defaultTimes() });
      await load();
      setTab("elections");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (electionId, status) => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await api.adminUpdateElection(electionId, { status });
      setInfo(`Election #${electionId} → status updated`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteElection = async (electionId) => {
    if (!window.confirm(`Delete election #${electionId}? Only allowed if it has 0 votes.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.adminDeleteElection(electionId);
      setInfo(`Election #${electionId} deleted`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const getCandForm = (eid) => candidateForms[eid] || { ...emptyCandidate };

  const setCand = (eid, key, value) => {
    setCandidateForms((m) => ({
      ...m,
      [eid]: { ...getCandForm(eid), [key]: value },
    }));
  };

  const addCandidate = async (electionId) => {
    const form = getCandForm(electionId);
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await api.adminAddCandidate(electionId, {
        name: form.name.trim(),
        party: form.party.trim(),
        manifesto: form.manifesto.trim(),
      });
      setInfo(`Candidate added to election #${electionId}`);
      setCandidateForms((m) => ({ ...m, [electionId]: { ...emptyCandidate } }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeCandidate = async (electionId, candidateId, name) => {
    if (!window.confirm(`Remove candidate "${name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.adminRemoveCandidate(electionId, candidateId);
      setInfo("Candidate removed");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="container">
        <div className="page-title">
          <h1>Admin</h1>
        </div>
        <div className="alert alert-warn">
          Please <Link to="/login">login</Link> with an admin account (
          <span className="mono">ADMIN-0001 / 0001</span>).
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container">
        <div className="page-title">
          <h1>Admin</h1>
        </div>
        <div className="alert alert-error">
          You do not have admin privileges. Only election officers can manage elections.
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="page-title flex-between">
        <div>
          <h1>Admin console</h1>
          <p>
            Signed in as <strong>{user?.name}</strong> — create elections, candidates, and control
            status. Regular voters cannot access these actions.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={busy}>
          Refresh
        </button>
      </div>

      <section className="section">
        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-success">{info}</div>}

        <div className="feature-pills mb-2" style={{ gap: 8 }}>
          {[
            ["elections", "Elections & candidates"],
            ["voters", "Voters"],
            ["audit", "Audit log"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn-sm ${tab === id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "elections" && (
          <>
            <div className="card mb-2">
              <h3 style={{ marginBottom: "0.75rem" }}>Create upcoming election</h3>
              <form onSubmit={createElection}>
                <div className="form-group">
                  <label className="form-label">Title *</label>
                  <input
                    className="form-input"
                    value={electionForm.title}
                    onChange={setEF("title")}
                    placeholder="e.g. Student Council Election 2026"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={electionForm.description}
                    onChange={setEF("description")}
                    placeholder="What is this election about?"
                    required
                  />
                </div>
                <div className="grid-2" style={{ gap: "0.75rem" }}>
                  <div className="form-group">
                    <label className="form-label">Start *</label>
                    <input
                      className="form-input"
                      type="datetime-local"
                      value={electionForm.startLocal}
                      onChange={setEF("startLocal")}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End *</label>
                    <input
                      className="form-input"
                      type="datetime-local"
                      value={electionForm.endLocal}
                      onChange={setEF("endLocal")}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Initial status</label>
                  <select className="form-input" value={electionForm.status} onChange={setEF("status")}>
                    <option value={0}>Draft</option>
                    <option value={1}>Upcoming</option>
                    <option value={2}>Active (voting open — needs candidates first)</option>
                  </select>
                </div>
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? <span className="spinner" /> : "Create election"}
                </button>
              </form>
            </div>

            <h2 style={{ fontSize: "1.2rem", marginBottom: "0.85rem" }}>Manage elections</h2>
            {!elections.length && <div className="card empty">No elections yet.</div>}

            <div style={{ display: "grid", gap: "1rem" }}>
              {elections.map((el) => {
                const cf = getCandForm(el.id);
                const canEditCandidates = el.status !== 3 && el.status !== 4 && !(el.status === 2 && el.totalVotes > 0);
                return (
                  <div className="card" key={el.id}>
                    <div className="flex-between" style={{ marginBottom: 8 }}>
                      <div>
                        <StatusBadge status={el.status} />
                        <span className="mono text-muted" style={{ marginLeft: 8 }}>
                          #{el.id}
                        </span>
                        <h3 style={{ marginTop: 6 }}>{el.title}</h3>
                        <p className="text-muted text-sm">{el.description}</p>
                        <div className="meta-row">
                          <span>{el.candidateCount} candidates</span>
                          <span>{el.totalVotes} votes</span>
                          <span>
                            {new Date(el.startTime * 1000).toLocaleString()} →{" "}
                            {new Date(el.endTime * 1000).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <Link to={`/elections/${el.id}`} className="btn btn-ghost btn-sm">
                        Open →
                      </Link>
                    </div>

                    <div className="feature-pills" style={{ marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                      <span className="text-sm text-muted" style={{ marginRight: 6 }}>
                        Set status:
                      </span>
                      {[
                        [0, "Draft"],
                        [1, "Upcoming"],
                        [2, "Active"],
                        [3, "Ended"],
                        [4, "Cancelled"],
                      ].map(([s, label]) => (
                        <button
                          key={s}
                          type="button"
                          className={`btn btn-sm ${el.status === s ? "btn-primary" : "btn-secondary"}`}
                          disabled={busy || el.status === s}
                          onClick={() => setStatus(el.id, s)}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy || el.totalVotes > 0}
                        onClick={() => deleteElection(el.id)}
                        title={el.totalVotes > 0 ? "Has votes — end/cancel instead" : "Delete"}
                      >
                        Delete
                      </button>
                    </div>

                    <h4 style={{ marginBottom: 8 }}>Candidates</h4>
                    {(el.candidates || []).length === 0 && (
                      <p className="text-sm text-muted mb-2">No candidates yet — add at least one before activating.</p>
                    )}
                    <div className="table-wrap mb-2">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Name</th>
                            <th>Party</th>
                            <th>Votes</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {(el.candidates || []).map((c) => (
                            <tr key={c.id}>
                              <td className="mono">{c.id}</td>
                              <td>{c.name}</td>
                              <td>{c.party}</td>
                              <td className="mono">{c.voteCount}</td>
                              <td>
                                {canEditCandidates && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={busy}
                                    onClick={() => removeCandidate(el.id, c.id, c.name)}
                                  >
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {canEditCandidates && (
                      <div
                        className="grid-2"
                        style={{
                          gap: "0.6rem",
                          alignItems: "end",
                          gridTemplateColumns: "1fr 1fr 1.4fr auto",
                        }}
                      >
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Name</label>
                          <input
                            className="form-input"
                            value={cf.name}
                            onChange={(e) => setCand(el.id, "name", e.target.value)}
                            placeholder="Candidate name"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Party</label>
                          <input
                            className="form-input"
                            value={cf.party}
                            onChange={(e) => setCand(el.id, "party", e.target.value)}
                            placeholder="Party"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Manifesto</label>
                          <input
                            className="form-input"
                            value={cf.manifesto}
                            onChange={(e) => setCand(el.id, "manifesto", e.target.value)}
                            placeholder="Short manifesto"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy || !cf.name.trim() || !cf.party.trim()}
                          onClick={() => addCandidate(el.id)}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "voters" && (
          <div className="card">
            <h3 style={{ marginBottom: "0.75rem" }}>Registered voters (masked)</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>ID</th>
                    <th>Region</th>
                    <th>Eligible</th>
                    <th>Source</th>
                    <th>Voted</th>
                  </tr>
                </thead>
                <tbody>
                  {voters.map((v, i) => (
                    <tr key={i}>
                      <td>
                        {v.name}
                        {v.isAdmin ? " ★" : ""}
                      </td>
                      <td className="mono">{v.nationalIdMasked}</td>
                      <td>{v.region}</td>
                      <td>{v.eligible === false ? "No" : "Yes"}</td>
                      <td className="mono text-sm">{v.source || "—"}</td>
                      <td className="mono">{(v.electionsVoted || []).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="card">
            <h3 style={{ marginBottom: "0.75rem" }}>Audit log</h3>
            <div className="live-feed">
              {audit.map((row, i) => (
                <div className="feed-item" key={i} style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <strong>{row.event}</strong>
                    <div className="mono">
                      {row.ts}
                      {row.electionId != null ? ` · election ${row.electionId}` : ""}
                      {row.title ? ` · ${row.title}` : ""}
                      {row.candidateName ? ` · ${row.candidateName}` : ""}
                      {row.txHash ? ` · ${String(row.txHash).slice(0, 14)}…` : ""}
                      {row.name ? ` · by ${row.name}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {!audit.length && <div className="empty">No events yet</div>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
