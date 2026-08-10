import { NavLink, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useWeb3 } from "../context/Web3Context";

export default function Navbar() {
  const { user, isAuthenticated, logout, isAdmin } = useAuth();
  const { account, shortAccount, connect, connecting, hasWallet, wrongNetwork } = useWeb3();

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">⬡</span>
          VoteChain
        </Link>

        <nav className="nav-links">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Home
          </NavLink>
          <NavLink to="/elections" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Elections
          </NavLink>
          <NavLink to="/live" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Live Tallies
          </NavLink>
          <NavLink to="/how-it-works" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Security
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
              Admin
            </NavLink>
          )}
        </nav>

        <div className="nav-right">
          {account ? (
            <span className={`wallet-chip${wrongNetwork ? " disconnected" : ""}`} title={account}>
              {wrongNetwork ? "⚠ Wrong network" : "●"} {shortAccount}
            </span>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => connect().catch(() => {})} disabled={connecting || !hasWallet}>
              {connecting ? "Connecting…" : hasWallet ? "Connect Wallet" : "No Wallet"}
            </button>
          )}

          {isAuthenticated ? (
            <>
              <span className="text-sm text-muted" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                {user?.name}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/register" className="btn btn-secondary btn-sm">
                Register
              </Link>
              <Link to="/login" className="btn btn-primary btn-sm">
                Voter Login
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
