import { isIP } from "node:net";
import type {
  OperatorRole,
  UpdateOperatorRequest,
} from "@/lib/operator-types";
import { isAssignableOperatorRole } from "@/lib/operator-types";
import {
  FirebaseAdminRestError,
  deleteFirebaseUser,
  getFirebaseUser,
  sendFirebasePasswordReset,
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

type RouteContext = {
  params: Promise<{ uid: string }>;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: responseHeaders });
}

function errorResponse(error: unknown): Response {
  if (error instanceof OperatorAuthorizationError || error instanceof FirebaseAdminRestError) {
    if (error.status >= 500) {
      console.error("[admin-user] service request failed", { code: error.code });
    }
    return json({ error: error.code }, error.status);
  }
  console.error("[admin-user] unexpected request failure");
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
  if (recent.length >= 40) {
    mutationWindows.set(operatorId, recent);
    return false;
  }
  recent.push(now);
  mutationWindows.set(operatorId, recent);
  return true;
}

function validUid(value: string): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 80;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return json({ error: "unsupported_media_type" }, 415);

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
    if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "invalid_request" }, 400);
    return value as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate : "127.0.0.1";
}

function effectiveFallbackRole(email: string): OperatorRole {
  if (email.toLowerCase() === getBootstrapOwnerEmail()) return "owner";
  if (isLegacyOperatorEmail(email)) return "operator";
  return "viewer";
}

function protectedOperator(
  callerUid: string,
  target: { uid: string; email: string; role: OperatorRole | null },
): boolean {
  return target.uid === callerUid || target.email.toLowerCase() === getBootstrapOwnerEmail() || target.role === "owner";
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const owner = await verifyOwner(request);
    if (!isSameOrigin(request)) return json({ error: "origin_not_allowed" }, 403);
    if (!mutationAllowed(owner.uid)) return json({ error: "rate_limit_exceeded" }, 429);
    const { uid } = await context.params;
    if (!validUid(uid)) return json({ error: "invalid_operator_id" }, 400);

    const payload = await readJsonObject(request);
    if (payload instanceof Response) return payload;
    const target = await getFirebaseUser(uid);
    const isProtected = protectedOperator(owner.uid, target);

    if (payload.action === "send_password_reset") {
      if (Object.keys(payload).length !== 1 || isProtected) {
        return json({ error: isProtected ? "protected_owner_account" : "invalid_request" }, isProtected ? 403 : 400);
      }
      await sendFirebasePasswordReset(uid, clientIp(request));
      return noContent();
    }

    const keys = Object.keys(payload);
    if (
      keys.length === 0 ||
      keys.some((key) => !["displayName", "role", "disabled", "temporaryPassword"].includes(key)) ||
      (payload.displayName !== undefined && !validDisplayName(payload.displayName)) ||
      (payload.role !== undefined && !isAssignableOperatorRole(payload.role)) ||
      (payload.disabled !== undefined && typeof payload.disabled !== "boolean") ||
      (payload.temporaryPassword !== undefined && !validPassword(payload.temporaryPassword))
    ) {
      return json({ error: "invalid_operator_details" }, 400);
    }

    if (
      isProtected &&
      (payload.role !== undefined || payload.disabled !== undefined || payload.temporaryPassword !== undefined)
    ) {
      return json({ error: "protected_owner_account" }, 403);
    }

    const updates: UpdateOperatorRequest = {
      ...(payload.displayName !== undefined ? { displayName: payload.displayName.trim() } : {}),
      ...(payload.role !== undefined ? { role: payload.role } : {}),
      ...(payload.disabled !== undefined ? { disabled: payload.disabled } : {}),
      ...(payload.temporaryPassword !== undefined ? { temporaryPassword: payload.temporaryPassword } : {}),
    };
    const updated = await updateFirebaseUser(uid, {
      displayName: updates.displayName,
      role: updates.role,
      disabled: updates.disabled,
      password: updates.temporaryPassword,
    });
    return json({ user: toOperatorUser(updated, effectiveFallbackRole(updated.email)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const owner = await verifyOwner(request);
    if (!isSameOrigin(request)) return json({ error: "origin_not_allowed" }, 403);
    if (!mutationAllowed(owner.uid)) return json({ error: "rate_limit_exceeded" }, 429);
    const { uid } = await context.params;
    if (!validUid(uid)) return json({ error: "invalid_operator_id" }, 400);

    const target = await getFirebaseUser(uid);
    if (protectedOperator(owner.uid, target)) {
      return json({ error: "protected_owner_account" }, 403);
    }
    await deleteFirebaseUser(uid);
    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}
