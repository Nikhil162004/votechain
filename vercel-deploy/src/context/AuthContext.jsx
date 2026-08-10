import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { getCredential, saveAccount } from "../lib/credentials";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("evoting_token"));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = localStorage.getItem("evoting_token");
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
      setToken(t);
    } catch {
      localStorage.removeItem("evoting_token");
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (nationalId, pin) => {
    const id = String(nationalId || "").trim();
    const credential = getCredential(id);
    const data = await api.login(id, String(pin || "").trim(), credential);
    localStorage.setItem("evoting_token", data.token);
    if (data.credential) {
      saveAccount({
        nationalId: data.loginHint?.nationalId || id,
        name: data.user?.name,
        credential: data.credential,
      });
    }
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async (payload) => {
    const data = await api.register(payload);
    if (data.token) {
      localStorage.setItem("evoting_token", data.token);
      setToken(data.token);
      setUser(data.user);
    }
    if (data.credential && data.loginHint?.nationalId) {
      saveAccount({
        nationalId: data.loginHint.nationalId,
        name: data.user?.name,
        credential: data.credential,
      });
    }
    return data;
  };

  const logout = () => {
    localStorage.removeItem("evoting_token");
    setToken(null);
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: !!user,
      isAdmin: !!user?.isAdmin,
      login,
      register,
      logout,
      refresh,
    }),
    [user, token, loading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
