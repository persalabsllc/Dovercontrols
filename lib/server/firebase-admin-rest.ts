import "server-only";

import { createSign } from "node:crypto";
import type { OperatorRole, OperatorUser } from "@/lib/operator-types";
import { isOperatorRole } from "@/lib/operator-types";

const FIREBASE_PROJECT_ID = "dovercontrols";
const FIREBASE_WEB_API_KEY = "AIzaSyBsAilApy0bezl_ENzgfTRlLXCOAWxsOPY";
const IDENTITY_TOOLKIT_ORIGIN = "https://identitytoolkit.googleapis.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_STS_URL = "https://sts.googleapis.com/v1/token";
const GOOGLE_IAM_CREDENTIALS_ORIGIN = "https://iamcredentials.googleapis.com";
const IDENTITY_TOOLKIT_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_GCP_PROJECT_NUMBER = "812439006468";
const DEFAULT_GCP_SERVICE_ACCOUNT_EMAIL =
  "dover-controls-web-admin@dovercontrols.iam.gserviceaccount.com";
const DEFAULT_GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel-dovercontrols";
const DEFAULT_GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";
const REQUEST_TIMEOUT_MS = 8_000;

type ServiceAccount = {
  type: "service_account";
  projectId: string;
  privateKeyId: string | null;
  privateKey: string;
  clientEmail: string;
};

type AccessToken = {
  value: string;
  expiresAt: number;
};

type GoogleErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

type ImpersonatedTokenResponse = {
  accessToken?: string;
  expireTime?: string;
};

type WorkloadIdentityConfig = {
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
};

type FirebaseUserInfo = {
  localId?: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
  customAttributes?: string;
};

type FirebaseUsersResponse = {
  users?: FirebaseUserInfo[];
  nextPageToken?: string;
};

type FirebaseCreateResponse = {
  localId?: string;
  email?: string;
  displayName?: string;
};

export type FirebaseAdminUser = {
  uid: string;
  email: string;
  displayName: string | null;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  role: OperatorRole | null;
  customClaims: Record<string, unknown>;
};

export class FirebaseAdminRestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "FirebaseAdminRestError";
  }
}

let serviceAccountCache: ServiceAccount | null = null;
let accessTokenCache: AccessToken | null = null;
let accessTokenRequest: Promise<AccessToken> | null = null;

function parseServiceAccount(): ServiceAccount {
  if (serviceAccountCache) return serviceAccountCache;

  const configured = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim();
  if (!configured) {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }

  let value: unknown;
  try {
    value = JSON.parse(configured) as unknown;
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }

  const candidate = value as Record<string, unknown>;
  const privateKey = typeof candidate.private_key === "string"
    ? candidate.private_key.replaceAll("\\n", "\n")
    : "";
  const clientEmail = typeof candidate.client_email === "string" ? candidate.client_email : "";
  const projectId = typeof candidate.project_id === "string" ? candidate.project_id : "";
  const tokenUri = typeof candidate.token_uri === "string" ? candidate.token_uri : GOOGLE_TOKEN_URL;

  if (
    candidate.type !== "service_account" ||
    projectId !== FIREBASE_PROJECT_ID ||
    tokenUri !== GOOGLE_TOKEN_URL ||
    !clientEmail.endsWith(".gserviceaccount.com") ||
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }

  serviceAccountCache = {
    type: "service_account",
    projectId,
    privateKeyId: typeof candidate.private_key_id === "string" && candidate.private_key_id
      ? candidate.private_key_id
      : null,
    privateKey,
    clientEmail,
  };
  return serviceAccountCache;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function requestServiceAccountAccessToken(): Promise<AccessToken> {
  const account = parseServiceAccount();
  const issuedAt = Math.floor(Date.now() / 1_000) - 30;
  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (account.privateKeyId) header.kid = account.privateKeyId;

  const claims = {
    iss: account.clientEmail,
    scope: IDENTITY_TOOLKIT_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3_600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  let signature: Buffer;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    signature = signer.sign(account.privateKey);
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }

  const assertion = `${unsigned}.${base64url(signature)}`;
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  if (!response.ok) {
    throw new FirebaseAdminRestError(503, "firebase_admin_authorization_failed");
  }

  let payload: TokenResponse;
  try {
    payload = (await response.json()) as TokenResponse;
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  if (
    typeof payload.access_token !== "string" ||
    !payload.access_token ||
    payload.token_type !== "Bearer" ||
    typeof payload.expires_in !== "number" ||
    payload.expires_in <= 0
  ) {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  return {
    value: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1_000,
  };
}

function workloadIdentityConfig(): WorkloadIdentityConfig {
  const projectNumber =
    process.env.GCP_PROJECT_NUMBER?.trim() || DEFAULT_GCP_PROJECT_NUMBER;
  const serviceAccountEmail =
    process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() || DEFAULT_GCP_SERVICE_ACCOUNT_EMAIL;
  const poolId =
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim() ||
    DEFAULT_GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId =
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim() ||
    DEFAULT_GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  if (
    !/^\d{6,20}$/.test(projectNumber) ||
    !/^[a-z][a-z0-9-]{3,31}$/.test(poolId) ||
    !/^[a-z][a-z0-9-]{3,31}$/.test(providerId) ||
    !/^[a-z0-9-]+@dovercontrols\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)
  ) {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }

  return { projectNumber, serviceAccountEmail, poolId, providerId };
}

function vercelOidcToken(request: Request): string {
  const token =
    request.headers.get("x-vercel-oidc-token")?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim() ||
    "";

  if (!token || token.length > 16_384 || token.split(".").length !== 3) {
    throw new FirebaseAdminRestError(503, "firebase_admin_not_configured");
  }
  return token;
}

async function requestWorkloadIdentityAccessToken(request: Request): Promise<AccessToken> {
  const config = workloadIdentityConfig();
  const audience =
    `//iam.googleapis.com/projects/${config.projectNumber}` +
    `/locations/global/workloadIdentityPools/${config.poolId}` +
    `/providers/${config.providerId}`;
  const exchangeBody = new URLSearchParams({
    audience,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: CLOUD_PLATFORM_SCOPE,
    subject_token: vercelOidcToken(request),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  });

  let exchangeResponse: Response;
  try {
    exchangeResponse = await fetch(GOOGLE_STS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: exchangeBody,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  if (!exchangeResponse.ok) {
    throw new FirebaseAdminRestError(503, "firebase_admin_authorization_failed");
  }

  let exchange: TokenResponse;
  try {
    exchange = (await exchangeResponse.json()) as TokenResponse;
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  if (
    typeof exchange.access_token !== "string" ||
    !exchange.access_token ||
    exchange.token_type !== "Bearer"
  ) {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  const serviceAccount = encodeURIComponent(config.serviceAccountEmail);
  let impersonationResponse: Response;
  try {
    impersonationResponse = await fetch(
      `${GOOGLE_IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/` +
        `${serviceAccount}:generateAccessToken`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${exchange.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: [IDENTITY_TOOLKIT_SCOPE],
          lifetime: "3600s",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  if (!impersonationResponse.ok) {
    throw new FirebaseAdminRestError(503, "firebase_admin_authorization_failed");
  }

  let impersonated: ImpersonatedTokenResponse;
  try {
    impersonated = (await impersonationResponse.json()) as ImpersonatedTokenResponse;
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  const expiresAt = impersonated.expireTime
    ? Date.parse(impersonated.expireTime)
    : Number.NaN;
  if (
    typeof impersonated.accessToken !== "string" ||
    !impersonated.accessToken ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  return { value: impersonated.accessToken, expiresAt };
}

async function requestAccessToken(request: Request): Promise<AccessToken> {
  const isVercelRuntime = process.env.VERCEL === "1" ||
    Boolean(request.headers.get("x-vercel-oidc-token")) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN?.trim());

  // Deployed functions must always use Vercel's short-lived identity. A stale
  // legacy JSON value must never silently override the keyless production path.
  if (isVercelRuntime) return requestWorkloadIdentityAccessToken(request);

  return process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim()
    ? requestServiceAccountAccessToken()
    : requestWorkloadIdentityAccessToken(request);
}

async function getAccessToken(request: Request): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt - 60_000 > Date.now()) {
    return accessTokenCache.value;
  }

  if (!accessTokenRequest) {
    accessTokenRequest = requestAccessToken(request).finally(() => {
      accessTokenRequest = null;
    });
  }

  accessTokenCache = await accessTokenRequest;
  return accessTokenCache.value;
}

function mappedGoogleError(response: Response, payload: GoogleErrorPayload | null): FirebaseAdminRestError {
  const message = payload?.error?.message ?? "";
  if (message.includes("EMAIL_EXISTS") || message.includes("DUPLICATE_EMAIL")) {
    return new FirebaseAdminRestError(409, "operator_email_exists");
  }
  if (message.includes("USER_NOT_FOUND")) {
    return new FirebaseAdminRestError(404, "operator_not_found");
  }
  if (
    message.includes("INVALID_EMAIL") ||
    message.includes("INVALID_PASSWORD") ||
    message.includes("PASSWORD_DOES_NOT_MEET_REQUIREMENTS") ||
    message.includes("WEAK_PASSWORD")
  ) {
    return new FirebaseAdminRestError(400, "invalid_operator_details");
  }
  if (response.status === 429) {
    return new FirebaseAdminRestError(429, "firebase_admin_rate_limited");
  }
  if (response.status === 401 || response.status === 403) {
    return new FirebaseAdminRestError(503, "firebase_admin_authorization_failed");
  }
  return new FirebaseAdminRestError(503, "firebase_admin_unavailable");
}

async function adminRequest<T>(
  path: string,
  init: RequestInit = {},
  request: Request,
): Promise<T> {
  const url = new URL(path, IDENTITY_TOOLKIT_ORIGIN);

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${await getAccessToken(request)}`);
  if (init.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  const raw = await response.text();
  let payload: unknown = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      if (response.ok) throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
    }
  }

  if (!response.ok) {
    throw mappedGoogleError(response, payload as GoogleErrorPayload);
  }

  return payload as T;
}

function parseCustomClaims(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function timestampToIso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeFirebaseUser(value: FirebaseUserInfo): FirebaseAdminUser | null {
  if (!value.localId || !value.email) return null;
  const customClaims = parseCustomClaims(value.customAttributes);
  const role = isOperatorRole(customClaims.doverRole) ? customClaims.doverRole : null;
  return {
    uid: value.localId,
    email: value.email.trim().toLowerCase(),
    displayName: typeof value.displayName === "string" && value.displayName.trim()
      ? value.displayName.trim()
      : null,
    disabled: value.disabled === true,
    emailVerified: value.emailVerified === true,
    createdAt: timestampToIso(value.createdAt),
    lastSignInAt: timestampToIso(value.lastLoginAt),
    role,
    customClaims,
  };
}

export function toOperatorUser(
  user: FirebaseAdminUser,
  fallbackRole: OperatorRole = "viewer",
): OperatorUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role ?? fallbackRole,
    disabled: user.disabled,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt,
  };
}

export async function listFirebaseUsers(request: Request): Promise<FirebaseAdminUser[]> {
  const projectId = encodeURIComponent(FIREBASE_PROJECT_ID);
  const users: FirebaseAdminUser[] = [];
  let nextPageToken = "";

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ maxResults: "1000" });
    if (nextPageToken) query.set("nextPageToken", nextPageToken);
    const payload = await adminRequest<FirebaseUsersResponse>(
      `/v1/projects/${projectId}/accounts:batchGet?${query.toString()}`,
      {},
      request,
    );
    for (const candidate of payload.users ?? []) {
      const user = normalizeFirebaseUser(candidate);
      if (user) users.push(user);
    }
    nextPageToken = payload.nextPageToken ?? "";
    if (!nextPageToken) return users;
  }

  throw new FirebaseAdminRestError(503, "firebase_admin_user_limit_exceeded");
}

export async function getFirebaseUser(
  uid: string,
  request: Request,
): Promise<FirebaseAdminUser> {
  const projectId = encodeURIComponent(FIREBASE_PROJECT_ID);
  const payload = await adminRequest<FirebaseUsersResponse>(
    `/v1/projects/${projectId}/accounts:lookup`,
    { method: "POST", body: JSON.stringify({ localId: [uid] }) },
    request,
  );
  const user = payload.users?.[0] ? normalizeFirebaseUser(payload.users[0]) : null;
  if (!user || user.uid !== uid) {
    throw new FirebaseAdminRestError(404, "operator_not_found");
  }
  return user;
}

export async function findFirebaseUserByEmail(
  email: string,
  request: Request,
): Promise<FirebaseAdminUser | null> {
  const projectId = encodeURIComponent(FIREBASE_PROJECT_ID);
  const normalizedEmail = email.trim().toLowerCase();
  const payload = await adminRequest<FirebaseUsersResponse>(
    `/v1/projects/${projectId}/accounts:lookup`,
    { method: "POST", body: JSON.stringify({ email: [normalizedEmail] }) },
    request,
  );
  const user = payload.users?.[0] ? normalizeFirebaseUser(payload.users[0]) : null;
  return user?.email === normalizedEmail ? user : null;
}

export async function updateFirebaseUser(
  uid: string,
  updates: {
    displayName?: string;
    disabled?: boolean;
    password?: string;
    role?: OperatorRole;
  },
  request: Request,
): Promise<FirebaseAdminUser> {
  const projectId = encodeURIComponent(FIREBASE_PROJECT_ID);
  const body: Record<string, unknown> = { localId: uid };
  if (updates.displayName !== undefined) body.displayName = updates.displayName;
  if (updates.disabled !== undefined) body.disableUser = updates.disabled;
  if (updates.password !== undefined) body.password = updates.password;

  if (updates.role !== undefined) {
    const current = await getFirebaseUser(uid, request);
    const customClaims = { ...current.customClaims, doverRole: updates.role };
    const serialized = JSON.stringify(customClaims);
    if (Buffer.byteLength(serialized, "utf8") > 1_000) {
      throw new FirebaseAdminRestError(400, "operator_claims_too_large");
    }
    body.customAttributes = serialized;
  }

  if (updates.disabled !== undefined || updates.password !== undefined) {
    body.validSince = String(Math.floor(Date.now() / 1_000));
  }

  await adminRequest(
    `/v1/projects/${projectId}/accounts:update`,
    { method: "POST", body: JSON.stringify(body) },
    request,
  );
  return getFirebaseUser(uid, request);
}

export async function createFirebaseUser(input: {
  email: string;
  displayName?: string;
  password: string;
  role: Exclude<OperatorRole, "owner">;
}, request: Request): Promise<FirebaseAdminUser> {
  const body: Record<string, unknown> = {
    targetProjectId: FIREBASE_PROJECT_ID,
    email: input.email,
    password: input.password,
    emailVerified: false,
    disabled: false,
  };
  if (input.displayName) body.displayName = input.displayName;

  // accounts.signUp is also the documented single-user admin create method
  // when called with an OAuth credential and targetProjectId.
  const created = await adminRequest<FirebaseCreateResponse>(
    `/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    { method: "POST", body: JSON.stringify(body) },
    request,
  );
  if (!created.localId) {
    throw new FirebaseAdminRestError(503, "firebase_admin_unavailable");
  }

  try {
    return await updateFirebaseUser(created.localId, { role: input.role }, request);
  } catch (error) {
    try {
      await deleteFirebaseUser(created.localId, request);
    } catch {
      // Avoid masking the original role-assignment failure.
    }
    throw error;
  }
}

export async function deleteFirebaseUser(uid: string, request: Request): Promise<void> {
  const projectId = encodeURIComponent(FIREBASE_PROJECT_ID);
  await adminRequest(
    `/v1/projects/${projectId}/accounts:delete`,
    { method: "POST", body: JSON.stringify({ localId: uid }) },
    request,
  );
}

export async function sendFirebasePasswordReset(
  uid: string,
  userIp: string,
  request: Request,
): Promise<void> {
  const projectId = encodeURIComponent(FIREBASE_PROJECT_ID);
  const user = await getFirebaseUser(uid, request);
  await adminRequest(
    `/v1/projects/${projectId}/accounts:sendOobCode`,
    {
      method: "POST",
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email: user.email,
        returnOobLink: false,
        userIp,
      }),
    },
    request,
  );
}
