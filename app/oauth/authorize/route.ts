import { NextResponse } from "next/server";
import { isAllowedChatGptRedirect, normalizeScopes, signPayload, verifyAdminPassword } from "@/lib/homeAssistantMcpBridge";

export const runtime = "nodejs";

function page(fields: Record<string,string>, error?: string) {
  const hidden = Object.entries(fields).map(([k,v]) => `<input type="hidden" name="${k}" value="${v.replaceAll('&','&amp;').replaceAll('"','&quot;')}">`).join('');
  return `<!doctype html><html><body style="font-family:system-ui;max-width:520px;margin:60px auto;padding:20px"><h1>Dover Home Assistant</h1><p>Authorize ChatGPT to access the Home Assistant bridge.</p>${error?`<p style="color:#b00020">${error}</p>`:''}<form method="post">${hidden}<label>Bridge admin passphrase<br><input name="admin_password" type="password" required style="width:100%;padding:10px;margin:8px 0 16px"></label><button type="submit" style="padding:10px 18px">Authorize</button></form></body></html>`;
}

function isAllowedClientId(clientId: string): boolean {
  if (clientId === "https://chatgpt.com") return true;
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const u = new URL(request.url);
  const fields = Object.fromEntries(["response_type","client_id","redirect_uri","code_challenge","code_challenge_method","state","scope"].map(k=>[k,u.searchParams.get(k)||""]));
  if (fields.response_type !== "code" || !isAllowedClientId(fields.client_id) || !isAllowedChatGptRedirect(fields.redirect_uri) || fields.code_challenge_method !== "S256" || !fields.code_challenge) {
    return new NextResponse("Invalid OAuth request", { status: 400 });
  }
  return new NextResponse(page(fields), { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const get = (k:string)=>String(form.get(k)||"");
  const redirectUri = get("redirect_uri");
  const clientId = get("client_id");
  if (get("response_type") !== "code" || !isAllowedClientId(clientId) || !isAllowedChatGptRedirect(redirectUri) || get("code_challenge_method") !== "S256" || !get("code_challenge")) return new NextResponse("Invalid OAuth request",{status:400});
  if (!verifyAdminPassword(get("admin_password"))) {
    const fields = Object.fromEntries(["response_type","client_id","redirect_uri","code_challenge","code_challenge_method","state","scope"].map(k=>[k,get(k)]));
    return new NextResponse(page(fields,"Incorrect passphrase."), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const now = Math.floor(Date.now()/1000);
  const code = signPayload({ typ:"code", iat:now, exp:now+300, client_id:clientId, redirect_uri:redirectUri, code_challenge:get("code_challenge"), scope:normalizeScopes(get("scope")) });
  const target = new URL(redirectUri); target.searchParams.set("code",code); if (get("state")) target.searchParams.set("state",get("state"));
  return NextResponse.redirect(target, 303);
}
