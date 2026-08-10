import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Elections from "./pages/Elections";
import ElectionDetail from "./pages/ElectionDetail";
import Live from "./pages/Live";
import HowItWorks from "./pages/HowItWorks";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/elections" element={<Elections />} />
          <Route path="/elections/:id" element={<ElectionDetail />} />
          <Route path="/live" element={<Live />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <span>VoteChain — Decentralized E-Voting with Identity Verification</span>
          <span className="mono">Solidity · Web3.js/Ethers · React · Node</span>
        </div>
      </footer>
    </div>
  );
}
