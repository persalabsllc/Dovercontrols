import {
  OperatorAuthorizationError,
  verifyOperator,
} from "@/lib/server/firebase-auth";
import {
  getClimateSnapshot,
  HomeAssistantBridgeError,
  setClimateTarget,
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

function errorResponse(error: unknown): Response {
  if (error instanceof OperatorAuthorizationError) {
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
    await verifyOperator(request);
    return json(await getClimateSnapshot());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const operator = await verifyOperator(request);

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

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !Object.hasOwn(payload, "temperature")
    ) {
      return json({ error: "invalid_request" }, 400);
    }

    const temperature = (payload as { temperature?: unknown }).temperature;
    if (typeof temperature !== "number") {
      return json({ error: "invalid_temperature" }, 400);
    }

    return json(await setClimateTarget(temperature));
  } catch (error) {
    return errorResponse(error);
  }
}
