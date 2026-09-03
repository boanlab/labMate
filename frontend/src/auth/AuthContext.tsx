import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, tokenStore } from "../api/client";
import { clearPrefs } from "../api/prefs";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  position: string;
  phone?: string;
  researcher_no?: string;
  delegated_admin: boolean;
  infra_manager?: boolean;
  must_change_password: boolean;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mustChange: boolean }>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  canManageUsers: boolean;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMe() {
    if (!tokenStore.access) {
      setMe(null);
      return;
    }
    try {
      const { data } = await api.get<Me>("/members/me");
      setMe(data);
    } catch {
      setMe(null);
    }
  }

  useEffect(() => {
    refreshMe().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const { data } = await api.post("/members/login", { email, password });
    tokenStore.set(data.access, data.refresh);
    await refreshMe();
    return { mustChange: !!data.must_change_password };
  }

  function logout() {
    const refresh = tokenStore.refresh;
    if (refresh) api.post("/members/logout", { refresh }).catch(() => {});
    tokenStore.clear();
    clearPrefs();          // 같은 PC 를 다른 사람이 쓸 때 앞사람 화면 설정이 남지 않도록
    setMe(null);
  }

  const canManageUsers = !!me && (me.role === "admin" || me.role === "staff" || me.role === "prof" || me.delegated_admin);

  return (
    <Ctx.Provider value={{ me, loading, login, logout, refreshMe, canManageUsers }}>
      {children}
    </Ctx.Provider>
  );
}
