import { NextResponse } from "next/server";
import { normalizeScopes, pkceS256, signPayload, verifyPayload } from "@/lib/homeAssistantMcpBridge";

export const runtime = "nodejs";

function tokenResponse(scope:string) {
  const now = Math.floor(Date.now()/1000);
  return {
    access_token: signPayload({ typ:"access", iat:now, exp:now+8*60*60, client_id:"https://chatgpt.com", scope }),
    token_type: "Bearer",
    expires_in: 8*60*60,
    refresh_token: signPayload({ typ:"refresh", iat:now, exp:now+30*24*60*60, client_id:"https://chatgpt.com", scope }),
    scope,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const params = contentType.includes("application/json")
    ? new URLSearchParams(Object.entries(await request.json()).map(([k,v])=>[k,String(v)]))
    : new URLSearchParams(await request.text());

  const grant = params.get("grant_type") || "";
  const clientId = params.get("client_id") || "https://chatgpt.com";
  if (clientId !== "https://chatgpt.com") return NextResponse.json({error:"invalid_client"},{status:401});

  if (grant === "authorization_code") {
    const code = verifyPayload(params.get("code") || "", "code");
    const verifier = params.get("code_verifier") || "";
    const redirectUri = params.get("redirect_uri") || "";
    if (!code || !verifier || code.redirect_uri !== redirectUri || code.code_challenge !== pkceS256(verifier)) {
      return NextResponse.json({error:"invalid_grant"},{status:400});
    }
    return NextResponse.json(tokenResponse(normalizeScopes(code.scope)), { headers: { "cache-control":"no-store" } });
  }

  if (grant === "refresh_token") {
    const refresh = verifyPayload(params.get("refresh_token") || "", "refresh");
    if (!refresh) return NextResponse.json({error:"invalid_grant"},{status:400});
    return NextResponse.json(tokenResponse(normalizeScopes(refresh.scope)), { headers: { "cache-control":"no-store" } });
  }

  return NextResponse.json({error:"unsupported_grant_type"},{status:400});
}
