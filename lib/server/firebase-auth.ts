import "server-only";

const FIREBASE_API_KEY = "AIzaSyBsAilApy0bezl_ENzgfTRlLXCOAWxsOPY";
const FIREBASE_LOOKUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`;

type FirebaseAccount = {
  localId?: string;
  email?: string;
  disabled?: boolean;
  validSince?: string;
};

type FirebaseLookupResponse = {
  users?: FirebaseAccount[];
};

export type VerifiedOperator = {
  uid: string;
  email: string;
};

export class OperatorAuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly code: string,
  ) {
    super(code);
    this.name = "OperatorAuthorizationError";
  }
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

function tokenIssuedAt(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iat?: unknown };
    return typeof decoded.iat === "number" ? decoded.iat : null;
  } catch {
    return null;
  }
}

function allowedEmails(): Set<string> {
  const configured = process.env.DOVER_ALLOWED_FIREBASE_EMAILS;
  if (!configured?.trim()) {
    throw new OperatorAuthorizationError(503, "operator_allowlist_not_configured");
  }

  const emails = new Set(
    configured
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (emails.size === 0) {
    throw new OperatorAuthorizationError(503, "operator_allowlist_not_configured");
  }
  return emails;
}

export async function verifyOperator(request: Request): Promise<VerifiedOperator> {
  const token = getBearerToken(request);
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

  const payload = (await response.json()) as FirebaseLookupResponse;
  const account = payload.users?.[0];
  if (!account?.localId || !account.email) {
    throw new OperatorAuthorizationError(401, "invalid_or_expired_session");
  }
  if (account.disabled) {
    throw new OperatorAuthorizationError(403, "operator_disabled");
  }

  const issuedAt = tokenIssuedAt(token);
  const validSince = Number(account.validSince ?? 0);
  if (issuedAt === null || (Number.isFinite(validSince) && issuedAt < validSince)) {
    throw new OperatorAuthorizationError(401, "invalid_or_expired_session");
  }

  const normalizedEmail = account.email.toLowerCase();
  const allowlist = allowedEmails();
  if (!allowlist.has(normalizedEmail)) {
    throw new OperatorAuthorizationError(403, "operator_not_authorized");
  }

  return { uid: account.localId, email: normalizedEmail };
}
