import { partyColor } from "../lib/contract";

export default function ResultsChart({ candidates = [], totalVotes = 0 }) {
  const max = Math.max(...candidates.map((c) => c.votes || c.voteCount || 0), 1);
  const total = totalVotes || candidates.reduce((s, c) => s + (c.votes || c.voteCount || 0), 0);

  if (!candidates.length) {
    return <div className="empty">No candidates yet.</div>;
  }

  return (
    <div>
      <div className="flex-between mb-2">
        <strong>Results</strong>
        <span className="mono text-muted">{total} total vote{total === 1 ? "" : "s"}</span>
      </div>
      {candidates.map((c, i) => {
        const votes = c.votes ?? c.voteCount ?? 0;
        const pct = total > 0 ? ((votes / total) * 100).toFixed(1) : "0.0";
        const width = `${(votes / max) * 100}%`;
        return (
          <div className="result-row" key={c.id || i}>
            <div className="result-top">
              <span>
                <strong>{c.name}</strong>
                <span className="text-muted"> · {c.party}</span>
              </span>
              <span className="mono">
                {votes} ({pct}%)
              </span>
            </div>
            <div className="result-bar">
              <div className="result-fill" style={{ width, background: partyColor(i) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
