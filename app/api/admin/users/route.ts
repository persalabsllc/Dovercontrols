import type {
  AdminUsersResponse,
  CreateOperatorRequest,
  OperatorRole,
} from "@/lib/operator-types";
import { isAssignableOperatorRole } from "@/lib/operator-types";
import {
  FirebaseAdminRestError,
  createFirebaseUser,
  findFirebaseUserByEmail,
  listFirebaseUsers,
  toOperatorUser,
  updateFirebaseUser,
} from "@/lib/server/firebase-admin-rest";
import {
  getBootstrapOwnerEmail,
  isLegacyOperatorEmail,
  OperatorAuthorizationError,
  verifyOwner,
} from "@/lib/server/firebase-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_048;
const mutationWindows = new Map<string, number[]>();
const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'",
  "Referrer-Policy": "no-referrer",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

function errorResponse(error: unknown): Response {
  if (error instanceof OperatorAuthorizationError || error instanceof FirebaseAdminRestError) {
    if (error.status >= 500) {
      console.error("[admin-users] service request failed", { code: error.code });
    }
    return json({ error: error.code }, error.status);
  }
  console.error("[admin-users] unexpected request failure");
  return json({ error: "operator_management_unavailable" }, 503);
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function mutationAllowed(operatorId: string): boolean {
  const now = Date.now();
  const recent = (mutationWindows.get(operatorId) ?? [])
    .filter((timestamp) => timestamp > now - 60 * 60_000);
  if (recent.length >= 20) {
    mutationWindows.set(operatorId, recent);
    return false;
  }
  recent.push(now);
  mutationWindows.set(operatorId, recent);
  return true;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 80;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  try {
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY_BYTES) {
      return json({ error: raw.length > MAX_BODY_BYTES ? "request_too_large" : "invalid_request" }, raw.length > MAX_BODY_BYTES ? 413 : 400);
    }
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return json({ error: "invalid_request" }, 400);
    }
    return value as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
}

function effectiveRole(user: { email: string; role: OperatorRole | null }): OperatorRole | null {
  if (normalizedEmail(user.email) === getBootstrapOwnerEmail()) return "owner";
  if (user.role === "operator" || user.role === "viewer") return user.role;
  if (isLegacyOperatorEmail(user.email)) return "operator";
  return null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    await verifyOwner(request);
    const users = (await listFirebaseUsers(request))
      .flatMap((user) => {
        const role = effectiveRole(user);
        return role ? [toOperatorUser(user, role)] : [];
      })
      .sort((left, right) => left.email.localeCompare(right.email));
    const response: AdminUsersResponse = { users };
    return json(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const owner = await verifyOwner(request);
    if (!isSameOrigin(request)) return json({ error: "origin_not_allowed" }, 403);
    if (!mutationAllowed(owner.uid)) return json({ error: "rate_limit_exceeded" }, 429);

    const payload = await readJsonObject(request);
    if (payload instanceof Response) return payload;
    const keys = Object.keys(payload);
    if (
      keys.some((key) => !["email", "displayName", "role", "temporaryPassword"].includes(key)) ||
      !Object.hasOwn(payload, "email") ||
      !Object.hasOwn(payload, "role") ||
      !Object.hasOwn(payload, "temporaryPassword")
    ) {
      return json({ error: "invalid_request" }, 400);
    }

    const email = typeof payload.email === "string" ? normalizedEmail(payload.email) : "";
    if (
      !validEmail(email) ||
      email === getBootstrapOwnerEmail() ||
      !isAssignableOperatorRole(payload.role) ||
      !validPassword(payload.temporaryPassword) ||
      (payload.displayName !== undefined && !validDisplayName(payload.displayName))
    ) {
      return json({ error: "invalid_operator_details" }, 400);
    }

    const input: CreateOperatorRequest = {
      email,
      role: payload.role,
      temporaryPassword: payload.temporaryPassword,
      ...(payload.displayName !== undefined ? { displayName: payload.displayName.trim() } : {}),
    };

    const existing = await findFirebaseUserByEmail(input.email, request);
    if (existing) {
      if (effectiveRole(existing)) {
        return json({ error: "operator_email_exists" }, 409);
      }

      const adopted = await updateFirebaseUser(existing.uid, {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        disabled: false,
        password: input.temporaryPassword,
        role: input.role,
      }, request);
      return json({ user: toOperatorUser(adopted, input.role) });
    }

    const user = await createFirebaseUser({
      email: input.email,
      displayName: input.displayName,
      password: input.temporaryPassword,
      role: input.role,
    }, request);
    return json({ user: toOperatorUser(user, input.role) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
