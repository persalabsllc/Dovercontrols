import {
  OperatorAuthorizationError,
  verifyOperator,
} from "@/lib/server/firebase-auth";
import type { ClimateCommand } from "@/lib/climate-types";
import {
  executeClimateCommand,
  getClimateSnapshot,
  HomeAssistantBridgeError,
} from "@/lib/server/home-assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'",
  "Referrer-Policy": "no-referrer",
  "Vary": "Authorization",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

const climateReadRoles = ["owner", "operator", "viewer"] as const;
const mutationWindows = new Map<string, number[]>();

function mutationAllowed(operatorId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (mutationWindows.get(operatorId) ?? []).filter((timestamp) => timestamp > windowStart);
  if (recent.length >= 10) {
    mutationWindows.set(operatorId, recent);
    return false;
  }

  recent.push(now);
  mutationWindows.set(operatorId, recent);
  return true;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function parseClimateCommand(payload: unknown): ClimateCommand | null {
  if (!isRecord(payload)) return null;

  // Keep the original temperature-only contract working while the UI adopts
  // the explicit action form.
  if (hasExactKeys(payload, ["temperature"]) && typeof payload.temperature === "number") {
    return { action: "set_temperature", temperature: payload.temperature };
  }

  if (typeof payload.action !== "string") return null;
  switch (payload.action) {
    case "set_temperature":
      if (
        hasExactKeys(payload, ["action", "temperature"]) &&
        typeof payload.temperature === "number"
      ) {
        return { action: payload.action, temperature: payload.temperature };
      }
      if (
        hasExactKeys(payload, ["action", "targetLow", "targetHigh"]) &&
        typeof payload.targetLow === "number" &&
        typeof payload.targetHigh === "number"
      ) {
        return {
          action: payload.action,
          targetLow: payload.targetLow,
          targetHigh: payload.targetHigh,
        };
      }
      return null;

    case "set_hvac_mode":
      return hasExactKeys(payload, ["action", "hvacMode"]) &&
        typeof payload.hvacMode === "string"
        ? { action: payload.action, hvacMode: payload.hvacMode }
        : null;

    case "set_fan_mode":
      return hasExactKeys(payload, ["action", "fanMode"]) &&
        typeof payload.fanMode === "string"
        ? { action: payload.action, fanMode: payload.fanMode }
        : null;

    case "set_preset_mode":
      return hasExactKeys(payload, ["action", "presetMode"]) &&
        typeof payload.presetMode === "string"
        ? { action: payload.action, presetMode: payload.presetMode }
        : null;

    case "set_schedule_mode":
      return hasExactKeys(payload, ["action", "scheduleMode"]) &&
        typeof payload.scheduleMode === "string"
        ? { action: payload.action, scheduleMode: payload.scheduleMode }
        : null;

    case "clear_hold":
      return hasExactKeys(payload, ["action"])
        ? { action: payload.action }
        : null;

    default:
      return null;
  }
}

function operatorCanMutate(operator: Awaited<ReturnType<typeof verifyOperator>>): boolean {
  return !("role" in operator) || operator.role !== "viewer";
}

function errorResponse(error: unknown): Response {
  if (error instanceof OperatorAuthorizationError) {
    if (error.status === 503) {
      console.error("[home-assistant-climate] operator verification failed", {
        code: error.code,
        status: error.status,
      });
    }
    return json({ error: error.code }, error.status);
  }
  if (error instanceof HomeAssistantBridgeError) {
    console.error("[home-assistant-climate] bridge request failed", {
      code: error.code,
      status: error.status,
    });
    return json({ error: error.code }, error.status);
  }

  console.error("[home-assistant-climate] unexpected bridge error");
  return json({ error: "bridge_unavailable" }, 503);
}

export async function GET(request: Request): Promise<Response> {
  try {
    await verifyOperator(request, climateReadRoles);
    return json(await getClimateSnapshot());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const operator = await verifyOperator(request, climateReadRoles);

    if (!operatorCanMutate(operator)) {
      return json({ error: "operator_read_only" }, 403);
    }

    if (!mutationAllowed(operator.uid)) {
      return json({ error: "rate_limit_exceeded" }, 429);
    }

    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return json({ error: "origin_not_allowed" }, 403);
    }

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return json({ error: "unsupported_media_type" }, 415);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 1_024) {
      return json({ error: "request_too_large" }, 413);
    }

    let payload: unknown;
    try {
      const body = await request.text();
      if (!body || body.length > 1_024) {
        return json({ error: "invalid_request" }, body.length > 1_024 ? 413 : 400);
      }
      payload = JSON.parse(body) as unknown;
    } catch {
      return json({ error: "invalid_request" }, 400);
    }

    const command = parseClimateCommand(payload);
    if (!command) return json({ error: "invalid_request" }, 400);

    return json(await executeClimateCommand(command));
  } catch (error) {
    return errorResponse(error);
  }
}
