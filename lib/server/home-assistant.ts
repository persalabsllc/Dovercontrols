import "server-only";

import type {
  ClimateActionName,
  ClimateCommand,
  ClimateCommandResult,
  ClimateSnapshot,
} from "@/lib/climate-types";

export type { ClimateSnapshot } from "@/lib/climate-types";

const DEFAULT_CLIMATE_ENTITY_ID = "climate.dover_house";
const DEFAULT_SCHEDULE_MODE_ENTITY_ID = "select.dover_house_current_mode";
const DEFAULT_CLEAR_HOLD_ENTITY_ID = "button.dover_house_clear_hold";
const EXPECTED_CLIMATE_NAME = "Dover House";
const MIN_ALLOWED_TARGET = 60;
const MAX_ALLOWED_TARGET = 80;
const COMMAND_ATTEMPTS = 8;
const COMMAND_POLL_INTERVAL_MS = 500;

const CLIMATE_FEATURE_TARGET_TEMPERATURE = 1;
const CLIMATE_FEATURE_TARGET_TEMPERATURE_RANGE = 2;
const CLIMATE_FEATURE_FAN_MODE = 8;
const CLIMATE_FEATURE_PRESET_MODE = 16;

type HomeAssistantState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
};

type ClimateStateBundle = {
  climate: HomeAssistantState;
  scheduleMode: HomeAssistantState | null;
  clearHold: HomeAssistantState | null;
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

function configuredEntityId(
  environmentName: string,
  fallback: string,
  domain: "climate" | "select" | "button",
): string {
  const configured = process.env[environmentName]?.trim();
  if (!configured) return fallback;
  if (!new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(configured)) {
    throw new HomeAssistantBridgeError(503, "invalid_climate_configuration");
  }
  return configured;
}

function configuredClimateEntityId(): string {
  return configuredEntityId(
    "HA_CLIMATE_ENTITY_ID",
    DEFAULT_CLIMATE_ENTITY_ID,
    "climate",
  );
}

function configuredScheduleModeEntityId(): string {
  return configuredEntityId(
    "HA_SCHEDULE_MODE_ENTITY_ID",
    DEFAULT_SCHEDULE_MODE_ENTITY_ID,
    "select",
  );
}

function configuredClearHoldEntityId(): string {
  return configuredEntityId(
    "HA_CLEAR_HOLD_ENTITY_ID",
    DEFAULT_CLEAR_HOLD_ENTITY_ID,
    "button",
  );
}

async function resolveClimateState(): Promise<HomeAssistantState> {
  const state = await readState(configuredClimateEntityId());
  if (!state) throw new HomeAssistantBridgeError(503, "climate_entity_not_found");
  return state;
}

async function resolveClimateBundle(): Promise<ClimateStateBundle> {
  const [climate, scheduleMode, clearHold] = await Promise.all([
    resolveClimateState(),
    readState(configuredScheduleModeEntityId()),
    readState(configuredClearHoldEntityId()),
  ]);
  return { climate, scheduleMode, clearHold };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter((option): option is string => typeof option === "string" && !!option.trim()),
  )];
}

function supportsFeature(attributes: Record<string, unknown>, feature: number): boolean {
  const supported = finiteNumber(attributes.supported_features);
  return supported !== null && (supported & feature) === feature;
}

function stateAvailable(state: HomeAssistantState | null): state is HomeAssistantState {
  return !!state && state.state !== "unavailable";
}

function normalizeClimate(bundle: ClimateStateBundle): ClimateSnapshot {
  const { climate, scheduleMode, clearHold } = bundle;
  const attributes = climate.attributes;
  const targetTemperature = finiteNumber(attributes.temperature)
    ?? finiteNumber(attributes.target_temp_high)
    ?? finiteNumber(attributes.target_temp_low);
  const targetTemperatureLow = finiteNumber(attributes.target_temp_low);
  const targetTemperatureHigh = finiteNumber(attributes.target_temp_high);
  const minTemperature = Math.max(
    MIN_ALLOWED_TARGET,
    finiteNumber(attributes.min_temp) ?? MIN_ALLOWED_TARGET,
  );
  const maxTemperature = Math.min(
    MAX_ALLOWED_TARGET,
    finiteNumber(attributes.max_temp) ?? MAX_ALLOWED_TARGET,
  );
  const temperatureStep = finiteNumber(attributes.target_temp_step) ?? 1;
  if (minTemperature > maxTemperature || temperatureStep <= 0) {
    throw new HomeAssistantBridgeError(503, "invalid_climate_configuration");
  }

  const available = climate.state !== "unavailable" && climate.state !== "unknown";
  const hvacModes = stringOptions(attributes.hvac_modes);
  const fanModes = stringOptions(attributes.fan_modes);
  const presetModes = stringOptions(attributes.preset_modes);
  const scheduleModes = stateAvailable(scheduleMode)
    ? stringOptions(scheduleMode.attributes.options)
    : [];
  const scheduleState = stateAvailable(scheduleMode) &&
    scheduleMode.state !== "unknown" &&
    scheduleMode.state.trim()
    ? scheduleMode.state
    : null;

  const canSetTemperature = supportsFeature(
    attributes,
    CLIMATE_FEATURE_TARGET_TEMPERATURE,
  );
  const canSetTemperatureRange = supportsFeature(
    attributes,
    CLIMATE_FEATURE_TARGET_TEMPERATURE_RANGE,
  );

  return {
    available,
    name: optionalString(attributes.friendly_name) ?? EXPECTED_CLIMATE_NAME,
    currentTemperature: finiteNumber(attributes.current_temperature),
    targetTemperature,
    targetTemperatureLow,
    targetTemperatureHigh,
    humidity: finiteNumber(attributes.current_humidity),
    hvacMode: climate.state,
    hvacModes,
    hvacAction: optionalString(attributes.hvac_action),
    fanMode: optionalString(attributes.fan_mode),
    fanModes,
    presetMode: optionalString(attributes.preset_mode),
    presetModes,
    scheduleMode: scheduleState,
    scheduleModes,
    temperatureUnit: optionalString(attributes.temperature_unit)
      ?? optionalString(attributes.unit_of_measurement)
      ?? "°F",
    temperatureStep,
    minTemperature,
    maxTemperature,
    capabilities: {
      setTemperature: available && canSetTemperature,
      setTemperatureRange: available && canSetTemperatureRange,
      setHvacMode: available && hvacModes.length > 0,
      setFanMode: available && fanModes.length > 0 && supportsFeature(
        attributes,
        CLIMATE_FEATURE_FAN_MODE,
      ),
      setPresetMode: available && presetModes.length > 0 && supportsFeature(
        attributes,
        CLIMATE_FEATURE_PRESET_MODE,
      ),
      setScheduleMode: available && scheduleModes.length > 0,
      clearHold: available && stateAvailable(clearHold),
    },
    updatedAt: climate.last_updated ?? null,
  };
}

async function callService(
  domain: "climate" | "select" | "button",
  service: string,
  serviceData: Record<string, unknown>,
): Promise<void> {
  const response = await homeAssistantFetch(`/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify(serviceData),
  });

  if (response.status === 401 || response.status === 403) {
    throw new HomeAssistantBridgeError(502, "home_assistant_authorization_failed");
  }
  if (!response.ok) {
    throw new HomeAssistantBridgeError(503, "climate_command_failed");
  }
}

function commandResult(
  snapshot: ClimateSnapshot,
  action: ClimateActionName,
  status: "confirmed" | "accepted",
): ClimateCommandResult {
  return { ...snapshot, command: { action, status } };
}

function ensureClimateAvailable(snapshot: ClimateSnapshot): void {
  if (!snapshot.available) {
    throw new HomeAssistantBridgeError(503, "climate_unavailable");
  }
}

function validateAdvertisedOption(
  value: string,
  options: string[],
  errorCode: string,
): void {
  if (!value || value.length > 64 || !options.includes(value)) {
    throw new HomeAssistantBridgeError(400, errorCode);
  }
}

function validateTemperature(value: number, snapshot: ClimateSnapshot): void {
  if (!Number.isFinite(value)) {
    throw new HomeAssistantBridgeError(400, "invalid_temperature");
  }
  if (value < snapshot.minTemperature || value > snapshot.maxTemperature) {
    throw new HomeAssistantBridgeError(400, "temperature_out_of_range");
  }

  const stepUnits = value / snapshot.temperatureStep;
  if (Math.abs(stepUnits - Math.round(stepUnits)) > 0.000_001) {
    throw new HomeAssistantBridgeError(400, "invalid_temperature_step");
  }
}

function temperatureMatches(actual: number | null, expected: number, step: number): boolean {
  if (actual === null) return false;
  const tolerance = Math.max(0.05, Math.min(0.25, step / 2));
  return Math.abs(actual - expected) <= tolerance;
}

async function pollForClimate(
  bundle: ClimateStateBundle,
  action: ClimateActionName,
  predicate: (snapshot: ClimateSnapshot) => boolean,
): Promise<ClimateCommandResult> {
  for (let attempt = 0; attempt < COMMAND_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_INTERVAL_MS));
    const snapshot = normalizeClimate({
      ...bundle,
      climate: await resolveClimateState(),
    });
    if (predicate(snapshot)) return commandResult(snapshot, action, "confirmed");
  }

  throw new HomeAssistantBridgeError(503, "climate_command_unconfirmed");
}

async function setTemperature(
  command: Extract<ClimateCommand, { action: "set_temperature" }>,
  bundle: ClimateStateBundle,
  snapshot: ClimateSnapshot,
): Promise<ClimateCommandResult> {
  if (snapshot.hvacMode === "heat_cool") {
    if (
      !("targetLow" in command) ||
      !("targetHigh" in command) ||
      !snapshot.capabilities.setTemperatureRange
    ) {
      throw new HomeAssistantBridgeError(400, "temperature_range_required");
    }
    validateTemperature(command.targetLow, snapshot);
    validateTemperature(command.targetHigh, snapshot);
    if (command.targetLow > command.targetHigh) {
      throw new HomeAssistantBridgeError(400, "invalid_temperature_range");
    }

    await callService("climate", "set_temperature", {
      entity_id: bundle.climate.entity_id,
      target_temp_low: command.targetLow,
      target_temp_high: command.targetHigh,
    });
    return pollForClimate(bundle, command.action, (updated) =>
      temperatureMatches(
        updated.targetTemperatureLow,
        command.targetLow,
        updated.temperatureStep,
      ) && temperatureMatches(
        updated.targetTemperatureHigh,
        command.targetHigh,
        updated.temperatureStep,
      ));
  }

  if (!("temperature" in command) || !snapshot.capabilities.setTemperature) {
    throw new HomeAssistantBridgeError(400, "single_temperature_required");
  }
  validateTemperature(command.temperature, snapshot);

  await callService("climate", "set_temperature", {
    entity_id: bundle.climate.entity_id,
    temperature: command.temperature,
  });
  return pollForClimate(bundle, command.action, (updated) => temperatureMatches(
    updated.targetTemperature,
    command.temperature,
    updated.temperatureStep,
  ));
}

export async function getClimateSnapshot(): Promise<ClimateSnapshot> {
  return normalizeClimate(await resolveClimateBundle());
}

export async function executeClimateCommand(
  command: ClimateCommand,
): Promise<ClimateCommandResult> {
  const bundle = await resolveClimateBundle();
  const snapshot = normalizeClimate(bundle);
  ensureClimateAvailable(snapshot);

  switch (command.action) {
    case "set_temperature":
      return setTemperature(command, bundle, snapshot);

    case "set_hvac_mode":
      if (!snapshot.capabilities.setHvacMode) {
        throw new HomeAssistantBridgeError(400, "hvac_mode_not_supported");
      }
      validateAdvertisedOption(command.hvacMode, snapshot.hvacModes, "invalid_hvac_mode");
      await callService("climate", "set_hvac_mode", {
        entity_id: bundle.climate.entity_id,
        hvac_mode: command.hvacMode,
      });
      return pollForClimate(
        bundle,
        command.action,
        (updated) => updated.hvacMode === command.hvacMode,
      );

    case "set_fan_mode":
      if (!snapshot.capabilities.setFanMode) {
        throw new HomeAssistantBridgeError(400, "fan_mode_not_supported");
      }
      validateAdvertisedOption(command.fanMode, snapshot.fanModes, "invalid_fan_mode");
      await callService("climate", "set_fan_mode", {
        entity_id: bundle.climate.entity_id,
        fan_mode: command.fanMode,
      });
      return pollForClimate(
        bundle,
        command.action,
        (updated) => updated.fanMode === command.fanMode,
      );

    case "set_preset_mode":
      if (!snapshot.capabilities.setPresetMode) {
        throw new HomeAssistantBridgeError(400, "preset_mode_not_supported");
      }
      validateAdvertisedOption(
        command.presetMode,
        snapshot.presetModes,
        "invalid_preset_mode",
      );
      await callService("climate", "set_preset_mode", {
        entity_id: bundle.climate.entity_id,
        preset_mode: command.presetMode,
      });
      return pollForClimate(
        bundle,
        command.action,
        (updated) => updated.presetMode === command.presetMode,
      );

    case "set_schedule_mode":
      if (!snapshot.capabilities.setScheduleMode || !bundle.scheduleMode) {
        throw new HomeAssistantBridgeError(400, "schedule_mode_not_supported");
      }
      validateAdvertisedOption(
        command.scheduleMode,
        snapshot.scheduleModes,
        "invalid_schedule_mode",
      );
      await callService("select", "select_option", {
        entity_id: bundle.scheduleMode.entity_id,
        option: command.scheduleMode,
      });
      return commandResult(
        { ...snapshot, scheduleMode: command.scheduleMode },
        command.action,
        "accepted",
      );

    case "clear_hold":
      if (!snapshot.capabilities.clearHold || !bundle.clearHold) {
        throw new HomeAssistantBridgeError(400, "clear_hold_not_supported");
      }
      await callService("button", "press", {
        entity_id: bundle.clearHold.entity_id,
      });
      return commandResult(snapshot, command.action, "accepted");
  }
}

export async function setClimateTarget(temperature: number): Promise<ClimateCommandResult> {
  return executeClimateCommand({ action: "set_temperature", temperature });
}
