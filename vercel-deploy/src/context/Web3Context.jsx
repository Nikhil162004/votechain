import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider } from "ethers";
import { api } from "../lib/api";
import { ensureChain, getDefaultAddress, getDefaultChainId, shortAddr } from "../lib/contract";

const Web3Context = createContext(null);

export function Web3Provider({ children }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [contractAddress, setContractAddress] = useState(getDefaultAddress());
  const [targetChainId, setTargetChainId] = useState(getDefaultChainId());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        if (cfg.contractAddress) setContractAddress(cfg.contractAddress);
        if (cfg.chainId) setTargetChainId(Number(cfg.chainId));
      })
      .catch(() => {});
  }, []);

  const sync = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_accounts", []);
    if (accounts[0]) setAccount(accounts[0]);
    else setAccount(null);
    const net = await provider.getNetwork();
    setChainId(Number(net.chainId));
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    sync();
    const onAccounts = (accs) => setAccount(accs[0] || null);
    const onChain = (id) => setChainId(parseInt(id, 16));
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [sync]);

  const connect = async () => {
    setError(null);
    setConnecting(true);
    try {
      if (!window.ethereum) {
        throw new Error("No Web3 wallet found. Install MetaMask to cast on-chain votes.");
      }
      await ensureChain(targetChainId);
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
      const net = await provider.getNetwork();
      setChainId(Number(net.chainId));
    } catch (e) {
      setError(e.message || "Failed to connect wallet");
      throw e;
    } finally {
      setConnecting(false);
    }
  };

  const wrongNetwork = chainId != null && Number(chainId) !== Number(targetChainId);

  const value = useMemo(
    () => ({
      account,
      shortAccount: shortAddr(account),
      chainId,
      targetChainId,
      contractAddress,
      connecting,
      error,
      hasWallet: typeof window !== "undefined" && !!window.ethereum,
      wrongNetwork,
      connect,
      setContractAddress,
    }),
    [account, chainId, targetChainId, contractAddress, connecting, error, wrongNetwork]
  );

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}

export function useWeb3() {
  const ctx = useContext(Web3Context);
  if (!ctx) throw new Error("useWeb3 outside provider");
  return ctx;
}
