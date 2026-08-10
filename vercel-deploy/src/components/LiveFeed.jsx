import { useEffect, useState } from "react";
import { api, openEventStream } from "../lib/api";
import { shortAddr } from "../lib/contract";

export default function LiveFeed({ electionId = null, compact = false }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let es;
    let poll;
    const load = () =>
      api
        .recentEvents()
        .then((d) => setEvents(d.events || []))
        .catch(() => {});

    load();
    // Poll works on Vercel serverless; SSE is best-effort
    poll = setInterval(load, 2500);

    try {
      es = openEventStream((msg) => {
        if (msg.type === "connected" && msg.recent) {
          setEvents((prev) => (prev.length ? prev : msg.recent));
          return;
        }
        if (msg.type === "VoteCast") {
          if (electionId && Number(msg.electionId) !== Number(electionId)) return;
          setEvents((prev) => [msg, ...prev].slice(0, 100));
        }
      });
    } catch {
      /* SSE optional */
    }

    return () => {
      es?.close();
      clearInterval(poll);
    };
  }, [electionId]);

  const filtered = electionId
    ? events.filter((e) => Number(e.electionId) === Number(electionId))
    : events;

  return (
    <div className={`card ${compact ? "" : ""}`}>
      <div className="flex-between mb-2">
        <h3 style={{ fontSize: "1.05rem" }}>
          <span className="feed-dot" style={{ display: "inline-block", marginRight: 8, verticalAlign: "middle" }} />
          Live Vote Feed
        </h3>
        <span className="badge badge-active">SSE</span>
      </div>
      <div className="live-feed">
        {!filtered.length && (
          <div className="empty" style={{ padding: "1.5rem" }}>
            Waiting for on-chain VoteCast events…
          </div>
        )}
        {filtered.map((ev, i) => (
          <div className="feed-item" key={`${ev.txHash || i}-${ev.nullifier || i}`}>
            <span className="feed-dot" />
            <div>
              <div>
                Election #{ev.electionId} · Candidate #{ev.candidateId}
              </div>
              <div className="mono">
                nullifier {ev.nullifier ? `${ev.nullifier.slice(0, 10)}…${ev.nullifier.slice(-6)}` : "—"}
                {" · "}
                caster {shortAddr(ev.caster)}
              </div>
              {ev.txHash && <div className="mono">tx {shortAddr(ev.txHash)}</div>}
            </div>
            <div className="mono" style={{ textAlign: "right" }}>
              tally {ev.newCandidateTally}
              <div className="text-muted">Σ {ev.newTotalVotes}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
