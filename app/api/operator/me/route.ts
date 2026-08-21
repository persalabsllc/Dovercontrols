import type { OperatorSession } from "@/lib/operator-types";
import {
  OperatorAuthorizationError,
  verifyAuthenticatedOperator,
} from "@/lib/server/firebase-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET(request: Request): Promise<Response> {
  try {
    const user: OperatorSession = await verifyAuthenticatedOperator(request);
    return json({ user });
  } catch (error) {
    if (error instanceof OperatorAuthorizationError) {
      return json({ error: error.code }, error.status);
    }
    console.error("[operator-me] unexpected authorization error");
    return json({ error: "identity_service_unavailable" }, 503);
  }
}
