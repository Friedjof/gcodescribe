import { req } from "./req";
import type { AuthSession, AuthSetupStart, AuthSetupFinish } from "../types/auth";

export const authClient = {
  health: () => req<{ ok: boolean; desktop: boolean }>("/api/health"),
  authSession: () => req<AuthSession>("/api/auth/session"),
  authSetupStart: (username: string, password: string) =>
    req<AuthSetupStart>("/api/auth/setup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  authSetupFinish: (setupId: string, code: string) =>
    req<AuthSetupFinish>("/api/auth/setup/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupId, code }),
    }),
  authLogin: (username: string, password: string, totpCode: string, recoveryCode: string) =>
    req<{ expires: number }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, totpCode, recoveryCode }),
    }),
  authLogout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
};
