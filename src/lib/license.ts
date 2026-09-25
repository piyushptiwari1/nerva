import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/**
 * Nerva Pro licence — frontend side.
 *
 * The frontend never decides "is Pro". It exchanges the user's licence key
 * for a device token at nerva.bytical.ai (`/api/license-activate`), hands the
 * token to the Rust core (`license_set_token`, which verifies the ECDSA
 * signature against the compiled-in public key) and then only ever reads
 * `license_status` back. Tokens last 30 days; we refresh silently when
 * < 10 days remain and we're online. Offline the last verified token keeps
 * working until it expires.
 */

const API = "https://nerva.bytical.ai/api";
export const BUY_URL = "https://nerva.bytical.ai/#pro";
const REFRESH_BEFORE_S = 10 * 24 * 3600;

export type Plan = "monthly" | "yearly" | "lifetime";

export interface LicenseStatus {
  active: boolean;
  plan: Plan | null;
  license_id: string | null;
  email_hint: string | null;
  license_exp: number | null;
  token_exp: number | null;
  device_id: string;
  reason: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  os: string;
  last_seen: string;
  this_device?: boolean;
}

interface LicenseState {
  status: LicenseStatus | null;
  key: string | null;
  devices: DeviceInfo[];
  limit: number | null;
  busy: boolean;
  error: string | null;
  /** Set when activation hit the device cap; UI offers to free a slot. */
  limitHit: boolean;
  isPro: boolean;
  load: () => Promise<void>;
  activate: (key: string) => Promise<boolean>;
  deactivateDevice: (deviceId: string) => Promise<void>;
  deactivateHere: () => Promise<void>;
  recover: (email: string) => Promise<boolean>;
}

const core = {
  deviceId: () => invoke<string>("device_id"),
  status: () => invoke<LicenseStatus>("license_status"),
  setToken: (token: string, key: string) => invoke<LicenseStatus>("license_set_token", { token, key }),
  key: () => invoke<string | null>("license_key"),
  clear: () => invoke<LicenseStatus>("license_clear"),
};

function osName(): string {
  const ua = navigator.userAgent;
  return ua.includes("Windows") ? "windows" : ua.includes("Mac") ? "macos" : "linux";
}
function deviceName(): string {
  const os = osName();
  return `${os[0].toUpperCase()}${os.slice(1)} · Nerva desktop`;
}

interface ActivateResp {
  token?: string;
  plan?: Plan;
  lexp?: number;
  limit?: number;
  devices?: DeviceInfo[];
  error?: string;
}

async function callActivate(key: string, deviceId: string): Promise<ActivateResp | null> {
  try {
    let version = "";
    try {
      version = (await invoke<{ version: string }>("get_runtime_info")).version;
    } catch {
      /* ignore */
    }
    const res = await fetch(`${API}/license-activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, device_id: deviceId, device_name: deviceName(), os: osName(), app_version: version }),
    });
    if (!res.ok) return { error: `server ${res.status}` };
    return (await res.json()) as ActivateResp;
  } catch {
    return null; // offline
  }
}

export const useLicense = create<LicenseState>((set, get) => ({
  status: null,
  key: null,
  devices: [],
  limit: null,
  busy: false,
  error: null,
  limitHit: false,
  isPro: false,

  async load() {
    let status: LicenseStatus | null = null;
    let key: string | null = null;
    try {
      [status, key] = await Promise.all([core.status(), core.key()]);
    } catch {
      return;
    }
    set({ status, key, isPro: !!status?.active });
    if (!key) return;
    // Silent refresh: token expiring soon, or token rejected (expired /
    // wrong device after a restore) but we still hold the key.
    const now = Math.floor(Date.now() / 1000);
    const needs = !status?.active || (status.token_exp ?? 0) - now < REFRESH_BEFORE_S;
    if (!needs) return;
    const r = await callActivate(key, status?.device_id ?? (await core.deviceId()));
    if (!r) return; // offline — keep whatever the core says
    if (r.token) {
      try {
        const s = await core.setToken(r.token, key);
        set({ status: s, isPro: s.active, devices: r.devices ?? [], limit: r.limit ?? null, error: null });
      } catch (e) {
        set({ error: String(e) });
      }
    } else if (r.error && r.error !== "device_limit") {
      // Revoked / expired server-side → drop Pro locally.
      set({ error: r.error, isPro: false });
      if (r.error === "revoked" || r.error === "expired") {
        try {
          const s = await core.clear();
          set({ status: s, key: null });
        } catch {
          /* ignore */
        }
      }
    }
  },

  async activate(rawKey) {
    const key = rawKey.trim();
    if (!key) return false;
    set({ busy: true, error: null, limitHit: false });
    try {
      const deviceId = await core.deviceId();
      const r = await callActivate(key, deviceId);
      if (!r) {
        set({ error: "Can't reach nerva.bytical.ai — check your connection and try again." });
        return false;
      }
      if (r.error === "device_limit") {
        set({ limitHit: true, devices: r.devices ?? [], limit: r.limit ?? null, key, error: null });
        return false;
      }
      if (!r.token) {
        set({ error: r.error ?? "activation failed" });
        return false;
      }
      const s = await core.setToken(r.token, key);
      set({ status: s, key, isPro: s.active, devices: r.devices ?? [], limit: r.limit ?? null });
      return s.active;
    } catch (e) {
      set({ error: String(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async deactivateDevice(deviceId) {
    const key = get().key;
    if (!key) return;
    set({ busy: true });
    try {
      const res = await fetch(`${API}/license-deactivate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, device_id: deviceId }),
      });
      const j = (await res.json()) as { devices?: DeviceInfo[]; limit?: number; error?: string };
      if (j.error) set({ error: j.error });
      else set({ devices: j.devices ?? [], limit: j.limit ?? get().limit, limitHit: false });
    } catch {
      set({ error: "offline" });
    } finally {
      set({ busy: false });
    }
  },

  async deactivateHere() {
    const { key, status } = get();
    if (key && status?.device_id) {
      await get().deactivateDevice(status.device_id);
    }
    try {
      const s = await core.clear();
      set({ status: s, key: null, isPro: false, devices: [], limit: null });
    } catch {
      /* ignore */
    }
  },

  async recover(email) {
    try {
      const res = await fetch(`${API}/license-recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return res.status === 204;
    } catch {
      return false;
    }
  },
}));

export function planLabel(p: Plan | null | undefined): string {
  return p === "lifetime" ? "Lifetime" : p === "yearly" ? "Yearly" : p === "monthly" ? "Monthly" : "";
}
