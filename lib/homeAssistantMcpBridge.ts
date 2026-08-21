import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_SCOPES = ["ha.read", "ha.write", "offline_access"];

export type BridgeTokenPayload = {
  typ: "code" | "access" | "refresh";
  exp: number;
  iat: number;
  client_id: string;
  scope: string;
  redirect_uri?: string;
  code_challenge?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function bridgeSecret(): string {
  return requireEnv("MCP_BRIDGE_SECRET");
}

export function adminPassword(): string {
  return requireEnv("MCP_ADMIN_PASSWORD");
}

export function homeAssistantBaseUrl(): string {
  return requireEnv("HOME_ASSISTANT_URL").replace(/\/$/, "");
}

export function homeAssistantToken(): string {
  return requireEnv("HOME_ASSISTANT_TOKEN");
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function signPayload(payload: BridgeTokenPayload): string {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", bridgeSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload(token: string, expectedType?: BridgeTokenPayload["typ"]): BridgeTokenPayload | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", bridgeSecret()).update(body).digest("base64url");
    if (!safeEqual(sig, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BridgeTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (expectedType && payload.typ !== expectedType) return null;
    return payload;
  } catch {
    return null;
  }
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function normalizeScopes(scope?: string | null): string {
  const requested = (scope || "").split(/\s+/).filter(Boolean);
  const allowed = new Set(DEFAULT_SCOPES);
  const filtered = requested.filter((s) => allowed.has(s));
  return (filtered.length ? filtered : DEFAULT_SCOPES).join(" ");
}

export function isAllowedChatGptRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && url.pathname.startsWith("/connector/oauth/");
  } catch {
    return false;
  }
}

export function verifyAdminPassword(candidate: string): boolean {
  return safeEqual(candidate, adminPassword());
}

export async function haRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${homeAssistantBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${homeAssistantToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try { body = JSON.parse(text); } catch { /* keep text */ }
  }
  if (!response.ok) {
    throw new Error(`Home Assistant ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

export function bearerPayload(request: Request): BridgeTokenPayload | null {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyPayload(match[1], "access");
}

export function hasScope(payload: BridgeTokenPayload, scope: "ha.read" | "ha.write"): boolean {
  return payload.scope.split(/\s+/).includes(scope);
}

export const SAFE_SERVICE_ALLOWLIST: Record<string, Set<string>> = {
  homeassistant: new Set(["turn_on", "turn_off", "toggle"]),
  light: new Set(["turn_on", "turn_off", "toggle"]),
  switch: new Set(["turn_on", "turn_off", "toggle"]),
  fan: new Set(["turn_on", "turn_off", "toggle", "set_percentage", "set_preset_mode"]),
  climate: new Set(["set_temperature", "set_hvac_mode", "set_fan_mode", "set_preset_mode"]),
  cover: new Set(["open_cover", "close_cover", "stop_cover", "set_cover_position"]),
  scene: new Set(["turn_on"]),
  script: new Set(["turn_on"]),
  input_boolean: new Set(["turn_on", "turn_off", "toggle"]),
  input_select: new Set(["select_option"]),
  input_number: new Set(["set_value"]),
  number: new Set(["set_value"]),
  select: new Set(["select_option"]),
  media_player: new Set(["media_play", "media_pause", "media_stop", "volume_set", "volume_up", "volume_down", "turn_on", "turn_off"]),
};

export function serviceAllowed(domain: string, service: string): { allowed: boolean; reason?: string } {
  if (domain === "lock") {
    if (process.env.MCP_ALLOW_SECURITY_WRITES !== "true") return { allowed: false, reason: "Security writes are disabled." };
    return { allowed: ["lock", "unlock"].includes(service), reason: "Only lock/unlock are allowed." };
  }
  if (domain === "button") {
    if (process.env.MCP_ALLOW_INFRASTRUCTURE_WRITES !== "true") return { allowed: false, reason: "Infrastructure button writes are disabled." };
    return { allowed: service === "press", reason: "Only button.press is allowed." };
  }
  const services = SAFE_SERVICE_ALLOWLIST[domain];
  if (!services || !services.has(service)) return { allowed: false, reason: `Service ${domain}.${service} is not allowlisted.` };
  return { allowed: true };
}

export function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
