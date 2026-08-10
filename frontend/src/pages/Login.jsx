import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { getLastNationalId, listSavedAccounts } from "../lib/credentials";

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [nationalId, setNationalId] = useState(() => getLastNationalId() || "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState([]);
  const [saved, setSaved] = useState([]);

  useEffect(() => {
    if (isAuthenticated) navigate("/elections");
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    api.demoVoters().then((d) => setDemo(d.voters || [])).catch(() => {});
    setSaved(listSavedAccounts());
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setHint("");
    setLoading(true);
    try {
      await login(nationalId.trim(), pin.trim());
      navigate("/elections");
    } catch (err) {
      setError(err.message || "Login failed");
      if (err.code === "NOT_FOUND" || err.code === "NEED_REREGISTER") {
        setHint(
          "Your new account may have been cleared after the server restarted (Vercel demo). Fix: open Register again with the same details, or use a demo account below. After this update, your browser will remember your account."
        );
      } else if (err.code === "BAD_PIN") {
        setHint("Use the PIN you typed at registration (4–6 digits), not your phone number.");
      } else if (err.data?.hint) {
        setHint(err.data.hint);
      }
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (v) => {
    setNationalId(v.nationalId);
    setPin(v.pin);
    setError("");
    setHint("");
  };

  const fillSaved = (a) => {
    setNationalId(a.nationalId);
    setPin("");
    setError("");
    setHint("Enter the PIN you created for this saved account, then Continue.");
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Voter login</h1>
        <p className="sub">
          Enter the <strong>same National / Voter ID</strong> and <strong>PIN</strong> you used at
          registration.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {hint && <div className="alert alert-warn">{hint}</div>}

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">National / Voter ID</label>
            <input
              className="form-input"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              placeholder="e.g. VOTER-8899"
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">PIN</label>
            <input
              className="form-input"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN you created at registration"
              autoComplete="current-password"
              required
            />
            <div className="form-hint">
              For demo seed accounts only, PIN = last 4 of ID (e.g. VOTER-1002 → 1002). Your own
              account uses the PIN you chose.
            </div>
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? <span className="spinner" /> : "Continue securely"}
          </button>
        </form>

        {!!saved.length && (
          <div className="demo-box">
            <h4>Saved on this browser — click ID, then enter PIN</h4>
            {saved.map((a) => (
              <div className="demo-row" key={a.nationalId} onClick={() => fillSaved(a)}>
                <span>{a.name || "Voter"}</span>
                <span className="mono">{a.nationalId}</span>
              </div>
            ))}
          </div>
        )}

        {!!demo.length && (
          <div className="demo-box">
            <h4>Demo accounts — click to fill (always work)</h4>
            {demo.map((v) => (
              <div className="demo-row" key={v.nationalId} onClick={() => fillDemo(v)}>
                <span>
                  {v.name}
                  {v.isAdmin ? " ★" : ""}
                </span>
                <span className="mono">
                  {v.nationalId} / {v.pin}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm text-muted mt-2" style={{ textAlign: "center" }}>
          New voter or login failing after a while?{" "}
          <Link to="/register">Register again</Link>
          <br />
          <Link to="/how-it-works">How identity + anonymity work →</Link>
        </p>
      </div>
    </div>
  );
}
