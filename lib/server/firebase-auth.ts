import "server-only";

import type { OperatorRole, OperatorSession } from "@/lib/operator-types";
import { isOperatorRole } from "@/lib/operator-types";
import { updateFirebaseUser } from "@/lib/server/firebase-admin-rest";

const FIREBASE_API_KEY = "AIzaSyBsAilApy0bezl_ENzgfTRlLXCOAWxsOPY";
const FIREBASE_LOOKUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`;
const DEFAULT_BOOTSTRAP_OWNER_EMAIL = "kkratoville@gmail.com";

type FirebaseAccount = {
  localId?: string;
  email?: string;
  displayName?: string;
  disabled?: boolean;
  validSince?: string;
  customAttributes?: string;
};

type FirebaseLookupResponse = {
  users?: FirebaseAccount[];
};

export type VerifiedOperator = OperatorSession;

export class OperatorAuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly code: string,
  ) {
    super(code);
    this.name = "OperatorAuthorizationError";
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getBootstrapOwnerEmail(): string {
  const configured = process.env.DOVER_BOOTSTRAP_OWNER_EMAIL?.trim();
  return normalizedEmail(configured || DEFAULT_BOOTSTRAP_OWNER_EMAIL);
}

function getBearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new OperatorAuthorizationError(401, "authorization_required");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || token.length > 8192) {
    throw new OperatorAuthorizationError(401, "invalid_authorization");
  }

  return token;
}

function tokenAuthenticationTime(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { auth_time?: unknown };
    return typeof decoded.auth_time === "number" ? decoded.auth_time : null;
  } catch {
    return null;
  }
}

function legacyAllowedEmails(): Set<string> {
  const configured = process.env.DOVER_ALLOWED_FIREBASE_EMAILS ?? "";
  return new Set(
    configured
      .split(",")
      .map(normalizedEmail)
      .filter(Boolean),
  );
}

export function isLegacyOperatorEmail(email: string): boolean {
  return legacyAllowedEmails().has(normalizedEmail(email));
}

function parseRole(customAttributes: unknown): OperatorRole | null {
  if (typeof customAttributes !== "string" || !customAttributes) return null;
  try {
    const claims = JSON.parse(customAttributes) as unknown;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    const role = (claims as Record<string, unknown>).doverRole;
    return isOperatorRole(role) ? role : null;
  } catch {
    return null;
  }
}

async function lookupAccount(token: string): Promise<FirebaseAccount> {
  let response: Response;

  try {
    response = await fetch(FIREBASE_LOOKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new OperatorAuthorizationError(503, "identity_service_unavailable");
  }

  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) {
      throw new OperatorAuthorizationError(503, "identity_service_unavailable");
    }
    throw new OperatorAuthorizationError(401, "invalid_or_expired_session");
  }

  let payload: FirebaseLookupResponse;
  try {
    payload = (await response.json()) as FirebaseLookupResponse;
  } catch {
    throw new OperatorAuthorizationError(503, "identity_service_unavailable");
  }

  const account = payload.users?.[0];
  if (!account?.localId || !account.email) {
    throw new OperatorAuthorizationError(401, "invalid_or_expired_session");
  }
  return account;
}

async function bootstrapOwnerClaim(account: FirebaseAccount): Promise<void> {
  if (!account.localId) return;
  try {
    await updateFirebaseUser(account.localId, { role: "owner" });
  } catch {
    // The configured bootstrap owner remains usable while the service account is commissioned.
    // A future request will retry seeding the persistent custom claim.
  }
}

export async function verifyAuthenticatedOperator(request: Request): Promise<VerifiedOperator> {
  const token = getBearerToken(request);
  const account = await lookupAccount(token);
  if (account.disabled) {
    throw new OperatorAuthorizationError(403, "operator_disabled");
  }

  const authenticationTime = tokenAuthenticationTime(token);
  const validSince = Number(account.validSince ?? 0);
  if (
    authenticationTime === null ||
    (Number.isFinite(validSince) && authenticationTime < validSince)
  ) {
    throw new OperatorAuthorizationError(401, "invalid_or_expired_session");
  }

  const email = normalizedEmail(account.email ?? "");
  const bootstrapOwnerEmail = getBootstrapOwnerEmail();
  const claimedRole = parseRole(account.customAttributes);
  let role: OperatorRole | null = claimedRole;

  if (email === bootstrapOwnerEmail) {
    role = "owner";
    if (claimedRole !== "owner") await bootstrapOwnerClaim(account);
  } else if (claimedRole === "owner") {
    // Only the explicitly configured bootstrap identity may hold the owner role.
    throw new OperatorAuthorizationError(403, "operator_not_authorized");
  } else if (!claimedRole && legacyAllowedEmails().has(email)) {
    role = "operator";
  }

  if (!role) {
    throw new OperatorAuthorizationError(403, "operator_not_authorized");
  }

  return {
    uid: account.localId ?? "",
    email,
    displayName: typeof account.displayName === "string" && account.displayName.trim()
      ? account.displayName.trim()
      : null,
    role,
  };
}

export async function verifyOperator(
  request: Request,
  allowedRoles: readonly OperatorRole[] = ["owner", "operator"],
): Promise<VerifiedOperator> {
  const operator = await verifyAuthenticatedOperator(request);
  if (!allowedRoles.includes(operator.role)) {
    throw new OperatorAuthorizationError(403, "operator_permission_denied");
  }
  return operator;
}

export async function verifyOwner(request: Request): Promise<VerifiedOperator> {
  return verifyOperator(request, ["owner"]);
}
