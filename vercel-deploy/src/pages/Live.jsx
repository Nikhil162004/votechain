import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import LiveFeed from "../components/LiveFeed";
import ResultsChart from "../components/ResultsChart";
import StatusBadge from "../components/StatusBadge";

export default function Live() {
  const [elections, setElections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = async () => {
    try {
      const d = await api.elections();
      const list = d.elections || [];
      setElections(list);
      const pick = selected || list.find((e) => e.status === 2)?.id || list[0]?.id;
      if (pick) {
        setSelected(Number(pick));
        const r = await api.results(pick);
        setResults(r);
        setUpdatedAt(r.updatedAt || d.updatedAt || new Date().toISOString());
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selected) return;
    api
      .results(selected)
      .then((r) => {
        setResults(r);
        setUpdatedAt(r.updatedAt || new Date().toISOString());
      })
      .catch(() => {});
  }, [selected]);

  const current = elections.find((e) => e.id === selected);

  return (
    <div className="container">
      <div className="page-title">
        <h1>Live tallies</h1>
        <p>
          Shared store results — auto-refresh every 2.5s
          {updatedAt ? ` · last update ${new Date(updatedAt).toLocaleTimeString()}` : ""}
        </p>
      </div>

      <section className="section">
        <div className="grid-2">
          <div>
            <div className="card mb-2">
              <label className="form-label">Election</label>
              <select
                className="form-input"
                value={selected || ""}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {elections.map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.id} — {e.title} ({e.totalVotes} votes)
                  </option>
                ))}
              </select>
              {current && (
                <div className="mt-2 flex-between">
                  <StatusBadge status={current.status} />
                  <Link to={`/elections/${current.id}`} className="btn btn-ghost btn-sm">
                    Open election →
                  </Link>
                </div>
              )}
            </div>

            <div className="card">
              {results ? (
                <ResultsChart candidates={results.candidates} totalVotes={results.totalVotes} />
              ) : (
                <div className="empty">Select an election</div>
              )}
            </div>
          </div>

          <LiveFeed electionId={selected} />
        </div>
      </section>
    </div>
  );
}
