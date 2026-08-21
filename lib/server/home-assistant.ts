import "server-only";

const DEFAULT_CLIMATE_ENTITY_ID = "climate.dover_house";
const EXPECTED_CLIMATE_NAME = "Dover House";
const MIN_ALLOWED_TARGET = 60;
const MAX_ALLOWED_TARGET = 80;

type HomeAssistantState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
};

export type ClimateSnapshot = {
  available: boolean;
  name: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  humidity: number | null;
  hvacMode: string;
  hvacAction: string | null;
  fanMode: string | null;
  presetMode: string | null;
  temperatureUnit: string;
  minTemperature: number;
  maxTemperature: number;
  updatedAt: string | null;
};

export class HomeAssistantBridgeError extends Error {
  constructor(
    public readonly status: 400 | 502 | 503,
    public readonly code: string,
  ) {
    super(code);
    this.name = "HomeAssistantBridgeError";
  }
}

function configuration(): { baseUrl: URL; token: string } {
  const rawBaseUrl = process.env.HA_BASE_URL?.trim();
  const token = process.env.HA_ACCESS_TOKEN?.trim();
  if (!rawBaseUrl || !token) {
    throw new HomeAssistantBridgeError(503, "bridge_not_configured");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new HomeAssistantBridgeError(503, "bridge_not_configured");
  }

  if (
    baseUrl.protocol !== "https:" ||
    !baseUrl.hostname.endsWith(".ui.nabu.casa") ||
    (baseUrl.port && baseUrl.port !== "443") ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new HomeAssistantBridgeError(503, "bridge_not_configured");
  }

  return { baseUrl, token };
}

async function homeAssistantFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, token } = configuration();
  const url = new URL(path, `${baseUrl.origin}/`);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  try {
    return await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HomeAssistantBridgeError(503, "home_assistant_unreachable");
  }
}

function isHomeAssistantState(value: unknown): value is HomeAssistantState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HomeAssistantState>;
  return (
    typeof candidate.entity_id === "string" &&
    typeof candidate.state === "string" &&
    !!candidate.attributes &&
    typeof candidate.attributes === "object"
  );
}

async function readState(entityId: string): Promise<HomeAssistantState | null> {
  const response = await homeAssistantFetch(`/api/states/${encodeURIComponent(entityId)}`);
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new HomeAssistantBridgeError(502, "home_assistant_authorization_failed");
  }
  if (!response.ok) {
    throw new HomeAssistantBridgeError(503, "home_assistant_unavailable");
  }

  const state = (await response.json()) as unknown;
  if (!isHomeAssistantState(state)) {
    throw new HomeAssistantBridgeError(503, "invalid_home_assistant_response");
  }
  return state;
}

function configuredClimateEntityId(): string {
  const configured = process.env.HA_CLIMATE_ENTITY_ID?.trim();
  if (!configured) return DEFAULT_CLIMATE_ENTITY_ID;
  if (!/^climate\.[a-z0-9_]+$/.test(configured)) {
    throw new HomeAssistantBridgeError(503, "invalid_climate_configuration");
  }
  return configured;
}

async function resolveClimateState(): Promise<HomeAssistantState> {
  const state = await readState(configuredClimateEntityId());
  if (!state) throw new HomeAssistantBridgeError(503, "climate_entity_not_found");
  return state;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeClimate(state: HomeAssistantState): ClimateSnapshot {
  const attributes = state.attributes;
  const target = finiteNumber(attributes.temperature)
    ?? finiteNumber(attributes.target_temp_high)
    ?? finiteNumber(attributes.target_temp_low);
  const minTemperature = Math.max(
    MIN_ALLOWED_TARGET,
    finiteNumber(attributes.min_temp) ?? MIN_ALLOWED_TARGET,
  );
  const maxTemperature = Math.min(
    MAX_ALLOWED_TARGET,
    finiteNumber(attributes.max_temp) ?? MAX_ALLOWED_TARGET,
  );
  if (minTemperature > maxTemperature) {
    throw new HomeAssistantBridgeError(503, "invalid_climate_configuration");
  }

  return {
    available: state.state !== "unavailable" && state.state !== "unknown",
    name: optionalString(attributes.friendly_name) ?? EXPECTED_CLIMATE_NAME,
    currentTemperature: finiteNumber(attributes.current_temperature),
    targetTemperature: target,
    humidity: finiteNumber(attributes.current_humidity),
    hvacMode: state.state,
    hvacAction: optionalString(attributes.hvac_action),
    fanMode: optionalString(attributes.fan_mode),
    presetMode: optionalString(attributes.preset_mode),
    temperatureUnit: optionalString(attributes.temperature_unit)
      ?? optionalString(attributes.unit_of_measurement)
      ?? "°F",
    minTemperature,
    maxTemperature,
    updatedAt: state.last_updated ?? null,
  };
}

export async function getClimateSnapshot(): Promise<ClimateSnapshot> {
  return normalizeClimate(await resolveClimateState());
}

export async function setClimateTarget(temperature: number): Promise<ClimateSnapshot> {
  if (
    !Number.isFinite(temperature) ||
    temperature < MIN_ALLOWED_TARGET ||
    temperature > MAX_ALLOWED_TARGET
  ) {
    throw new HomeAssistantBridgeError(400, "temperature_out_of_range");
  }

  const state = await resolveClimateState();
  const response = await homeAssistantFetch("/api/services/climate/set_temperature", {
    method: "POST",
    body: JSON.stringify({ entity_id: state.entity_id, temperature }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new HomeAssistantBridgeError(502, "home_assistant_authorization_failed");
  }
  if (!response.ok) {
    throw new HomeAssistantBridgeError(503, "climate_command_failed");
  }

  let snapshot: ClimateSnapshot | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await getClimateSnapshot();
    if (
      snapshot.targetTemperature !== null &&
      Math.abs(snapshot.targetTemperature - temperature) <= 0.25
    ) {
      return snapshot;
    }
  }

  throw new HomeAssistantBridgeError(503, "climate_command_unconfirmed");
}
