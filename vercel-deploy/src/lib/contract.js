import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

import deploymentFallback from "../config/deployment.json";
import abiFile from "../config/VotingSystem.json";

export const STATUS_LABELS = ["Draft", "Upcoming", "Active", "Ended", "Cancelled"];
export const STATUS_CLASS = ["draft", "draft", "active", "ended", "cancelled"];

const PARTY_COLORS = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#22d3ee", "#fb923c"];

export function partyColor(index) {
  return PARTY_COLORS[index % PARTY_COLORS.length];
}

export function getAbi() {
  return abiFile.abi || abiFile;
}

export function getDefaultAddress() {
  return import.meta.env.VITE_CONTRACT_ADDRESS || deploymentFallback.address || null;
}

export function getDefaultChainId() {
  return Number(import.meta.env.VITE_CHAIN_ID || deploymentFallback.chainId || 31337);
}

export async function getReadContract(address, rpcUrl) {
  const addr = address || getDefaultAddress();
  if (!addr) throw new Error("Contract address not configured");
  // Prefer wallet provider; fall back to public RPC
  let provider;
  if (window.ethereum) {
    provider = new BrowserProvider(window.ethereum);
  } else if (rpcUrl) {
    provider = new JsonRpcProvider(rpcUrl);
  } else {
    provider = new JsonRpcProvider("http://127.0.0.1:8545");
  }
  return new Contract(addr, getAbi(), provider);
}

export async function getWriteContract(address) {
  if (!window.ethereum) throw new Error("MetaMask (or another Web3 wallet) is required to vote");
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const addr = address || getDefaultAddress();
  return new Contract(addr, getAbi(), signer);
}

export function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatTs(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}

export async function ensureChain(targetChainId) {
  if (!window.ethereum) return false;
  const chainIdHex = "0x" + Number(targetChainId).toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return true;
  } catch (err) {
    // 4902 = chain not added
    if (err.code === 4902 || err.data?.originalError?.code === 4902) {
      const isLocal = Number(targetChainId) === 31337 || Number(targetChainId) === 1337;
      if (isLocal) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: Number(targetChainId) === 31337 ? "Hardhat Local" : "Ganache",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [
                Number(targetChainId) === 31337
                  ? "http://127.0.0.1:8545"
                  : "http://127.0.0.1:7545",
              ],
            },
          ],
        });
        return true;
      }
    }
    throw err;
  }
}
