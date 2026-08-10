import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import { formatTs } from "../lib/contract";

export default function Elections() {
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api
      .elections()
      .then((d) => setElections(d.elections || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="container">
      <div className="page-title flex-between">
        <div>
          <h1>Elections</h1>
          <p>All elections stored in the VotingSystem contract</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      <section className="section">
        {error && <div className="alert alert-error">{error}</div>}
        {loading ? (
          <div className="empty">Loading from chain…</div>
        ) : !elections.length ? (
          <div className="card empty">
            <p>No elections deployed yet.</p>
            <p className="text-sm mt-1">
              Run <code className="mono">npx hardhat run scripts/deploy.js --network localhost</code>
            </p>
          </div>
        ) : (
          <div className="grid-2">
            {elections.map((e) => (
              <Link
                key={e.id}
                to={`/elections/${e.id}`}
                className="card card-hover election-card"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="flex-between">
                  <StatusBadge status={e.status} />
                  <span className="mono text-muted">#{e.id}</span>
                </div>
                <h3>{e.title}</h3>
                <p>{e.description}</p>
                <div className="meta-row">
                  <span>{e.candidateCount} candidates</span>
                  <span>{e.totalVotes} votes</span>
                  <span>
                    {formatTs(e.startTime)} → {formatTs(e.endTime)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
