import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Admin() {
  const { isAdmin, isAuthenticated } = useAuth();
  const [audit, setAudit] = useState([]);
  const [voters, setVoters] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([api.adminAudit(), api.adminVoters()])
      .then(([a, v]) => {
        setAudit(a.log || []);
        setVoters(v.voters || []);
      })
      .catch((e) => setError(e.message));
  }, [isAdmin]);

  if (!isAuthenticated) {
    return (
      <div className="container">
        <div className="page-title">
          <h1>Admin</h1>
        </div>
        <div className="alert alert-warn">
          Please <Link to="/login">login</Link> with an admin account.
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
        <div className="alert alert-error">You do not have admin privileges.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="page-title">
        <h1>Admin console</h1>
        <p>Identity-layer audit (off-chain). Tallies remain on-chain.</p>
      </div>

      <section className="section">
        {error && <div className="alert alert-error">{error}</div>}

        <div className="grid-2">
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
                      {row.txHash ? ` · ${row.txHash.slice(0, 14)}…` : ""}
                      {row.idHash ? ` · ${row.idHash}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {!audit.length && <div className="empty">No events yet</div>}
            </div>
          </div>
        </div>

        <div className="card mt-2 alert-info" style={{ border: "1px solid rgba(99,102,241,0.3)" }}>
          <strong>Note:</strong> Creating elections and adding candidates is done by the contract
          owner/admin wallet via Hardhat scripts or a block explorer. This panel monitors the
          identity service only.
        </div>
      </section>
    </div>
  );
}
