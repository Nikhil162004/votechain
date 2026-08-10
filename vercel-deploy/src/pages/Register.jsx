import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

const FALLBACK_REGIONS = [
  "Maharashtra",
  "Delhi",
  "Karnataka",
  "Tamil Nadu",
  "Telangana",
  "Gujarat",
  "Rajasthan",
  "Uttar Pradesh",
  "West Bengal",
  "Kerala",
  "Punjab",
  "Haryana",
  "Madhya Pradesh",
  "Bihar",
  "Odisha",
  "Assam",
  "Pune",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
];

const empty = {
  name: "",
  email: "",
  nationalId: "",
  phone: "",
  region: "",
  dob: "",
  pin: "",
  confirmPin: "",
  citizenship: false,
  declareEligible: false,
};

export default function Register() {
  const navigate = useNavigate();
  const { isAuthenticated, register } = useAuth();
  const [form, setForm] = useState(empty);
  const [regions, setRegions] = useState(FALLBACK_REGIONS);
  const [errors, setErrors] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !success) navigate("/elections");
  }, [isAuthenticated, navigate, success]);

  useEffect(() => {
    api
      .regions()
      .then((d) => {
        if (d.regions?.length) setRegions(d.regions);
      })
      .catch(() => {});
  }, []);

  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setErrors([]);
    setSuccess("");
    setLoading(true);
    try {
      const data = await register({
        ...form,
        nationalId: form.nationalId.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        region: form.region.trim(),
      });
      const id = data.loginHint?.nationalId || form.nationalId.trim().toUpperCase();
      setLoginId(id);
      setSuccess(
        `Registered! To log in later use Voter ID: ${id} and the PIN you just created. Account is also saved in this browser.`
      );
      setTimeout(() => navigate("/elections"), 1200);
    } catch (err) {
      setError(err.message || "Registration failed");
      if (err.data?.errors?.length) setErrors(err.data.errors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ width: "min(560px, 100%)" }}>
        <h1>Voter registration</h1>
        <p className="sub">
          Only eligible citizens who pass validation can vote. After registering, log in with{" "}
          <strong>your Voter ID + your PIN</strong>.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {success && (
          <div className="alert alert-success">
            {success}
            {loginId && (
              <div className="mono mt-1" style={{ marginTop: 8 }}>
                Login ID: {loginId}
              </div>
            )}
          </div>
        )}
        {!!errors.length && (
          <div className="alert alert-warn">
            <strong>Fix the following:</strong>
            <ul style={{ margin: "0.4rem 0 0 1.1rem" }}>
              {errors.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Full name *</label>
            <input className="form-input" value={form.name} onChange={set("name")} placeholder="As on ID document" required />
          </div>

          <div className="grid-2" style={{ gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Email *</label>
              <input className="form-input" type="email" value={form.email} onChange={set("email")} required />
            </div>
            <div className="form-group">
              <label className="form-label">Mobile (India) *</label>
              <input className="form-input" value={form.phone} onChange={set("phone")} placeholder="10-digit mobile" required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">National / Voter ID * (this is your login username)</label>
            <input
              className="form-input"
              value={form.nationalId}
              onChange={set("nationalId")}
              placeholder="Aadhaar / PAN / VOTER-XXXX"
              required
            />
            <div className="form-hint">Remember this exactly — you will type it on the Login page.</div>
          </div>

          <div className="grid-2" style={{ gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Date of birth *</label>
              <input className="form-input" type="date" value={form.dob} onChange={set("dob")} required />
              <div className="form-hint">Must be 18+</div>
            </div>
            <div className="form-group">
              <label className="form-label">Region / State *</label>
              <select className="form-input" value={form.region} onChange={set("region")} required>
                <option value="">Select region</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid-2" style={{ gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Create PIN (4–6 digits) *</label>
              <input
                className="form-input"
                type="password"
                value={form.pin}
                onChange={set("pin")}
                inputMode="numeric"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm PIN *</label>
              <input
                className="form-input"
                type="password"
                value={form.confirmPin}
                onChange={set("confirmPin")}
                inputMode="numeric"
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ display: "grid", gap: "0.55rem" }}>
            <label className="text-sm" style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start" }}>
              <input type="checkbox" checked={form.citizenship} onChange={set("citizenship")} style={{ marginTop: 4 }} />
              <span>I confirm I am a citizen eligible to vote. *</span>
            </label>
            <label className="text-sm" style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={form.declareEligible}
                onChange={set("declareEligible")}
                style={{ marginTop: 4 }}
              />
              <span>I declare the information is true and I am not already registered. *</span>
            </label>
          </div>

          <button className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? <span className="spinner" /> : "Register & become eligible"}
          </button>
        </form>

        <p className="text-sm text-muted mt-2" style={{ textAlign: "center" }}>
          Already registered? <Link to="/login">Voter login</Link>
        </p>
      </div>
    </div>
  );
}
