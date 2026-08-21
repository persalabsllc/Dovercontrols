import { NextResponse } from "next/server";
import { bearerPayload, haRequest, hasScope, jsonRpcError, jsonRpcResult, serviceAllowed } from "@/lib/homeAssistantMcpBridge";

export const runtime = "nodejs";

const tools = [
  {
    name: "ha_search_entities",
    description: "Read Home Assistant entity states. Search by text and optionally filter by domain. Use this to inspect devices, sensors, climate, network, lights, locks, and other entities.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type:"object", properties:{ query:{type:"string"}, domain:{type:"string"}, limit:{type:"integer",minimum:1,maximum:200} }, additionalProperties:false }
  },
  {
    name: "ha_get_entity",
    description: "Read the current state and attributes of one Home Assistant entity by entity_id.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type:"object", properties:{ entity_id:{type:"string"} }, required:["entity_id"], additionalProperties:false }
  },
  {
    name: "ha_get_config",
    description: "Read basic Home Assistant system configuration and version information.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type:"object", properties:{}, additionalProperties:false }
  },
  {
    name: "ha_list_services",
    description: "Read the services/actions currently available in Home Assistant.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type:"object", properties:{ domain:{type:"string"} }, additionalProperties:false }
  },
  {
    name: "ha_call_service",
    description: "Change a Home Assistant device by calling an allowlisted service. Supports common lighting, switch, climate, fan, cover, media, scene, helper and selected lock/button actions. Security and infrastructure writes are disabled unless explicitly enabled on the bridge. Never use this tool merely to inspect state.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type:"object",
      properties:{ domain:{type:"string"}, service:{type:"string"}, entity_id:{type:"string"}, data:{type:"object",additionalProperties:true} },
      required:["domain","service"], additionalProperties:false
    }
  }
];

function unauthorized(request: Request) {
  const origin = new URL(request.url).origin;
  return new NextResponse(JSON.stringify({error:"unauthorized"}), {
    status:401,
    headers:{
      "content-type":"application/json",
      "www-authenticate":`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
    }
  });
}

async function callTool(name:string,args:Record<string,unknown>,writeAllowed:boolean) {
  if (name === "ha_search_entities") {
    const states = await haRequest("/api/states") as Array<Record<string,unknown>>;
    const q = String(args.query || "").toLowerCase();
    const domain = String(args.domain || "").toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit || 100),1),200);
    const filtered = states.filter((s:any)=> {
      const id = String(s.entity_id||"");
      if (domain && !id.startsWith(`${domain}.`)) return false;
      if (!q) return true;
      const hay = `${id} ${s.state||""} ${JSON.stringify(s.attributes||{})}`.toLowerCase();
      return hay.includes(q);
    }).slice(0,limit);
    return { count: filtered.length, entities: filtered };
  }
  if (name === "ha_get_entity") return await haRequest(`/api/states/${encodeURIComponent(String(args.entity_id||""))}`);
  if (name === "ha_get_config") return await haRequest("/api/config");
  if (name === "ha_list_services") {
    const services = await haRequest("/api/services") as Array<any>;
    const domain = String(args.domain || "");
    return domain ? services.filter((s:any)=>s.domain===domain) : services;
  }
  if (name === "ha_call_service") {
    if (!writeAllowed) throw new Error("OAuth token does not include ha.write scope.");
    const domain = String(args.domain||""); const service = String(args.service||"");
    const check = serviceAllowed(domain,service);
    if (!check.allowed) throw new Error(check.reason || "Service is not allowed.");
    const data = { ...(args.data && typeof args.data === "object" ? args.data : {}) } as Record<string,unknown>;
    if (args.entity_id) data.entity_id = String(args.entity_id);
    return await haRequest(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, { method:"POST", body:JSON.stringify(data) });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handleRpc(message:any,payload:any) {
  const id = message?.id;
  if (message?.method === "initialize") return jsonRpcResult(id,{ protocolVersion:"2025-06-18", capabilities:{tools:{listChanged:false}}, serverInfo:{name:"Dover Home Assistant Bridge",version:"1.0.0"} });
  if (message?.method === "ping") return jsonRpcResult(id,{});
  if (message?.method === "tools/list") return jsonRpcResult(id,{tools});
  if (message?.method === "tools/call") {
    const name = String(message.params?.name||""); const args = (message.params?.arguments||{}) as Record<string,unknown>;
    try {
      const result = await callTool(name,args,hasScope(payload,"ha.write"));
      return jsonRpcResult(id,{ content:[{type:"text",text:JSON.stringify(result,null,2)}], structuredContent:result, isError:false });
    } catch (error:any) {
      return jsonRpcResult(id,{ content:[{type:"text",text:error?.message||String(error)}], isError:true });
    }
  }
  if (message?.method?.startsWith("notifications/")) return null;
  return jsonRpcError(id,-32601,"Method not found");
}

export async function POST(request: Request) {
  const payload = bearerPayload(request);
  if (!payload || !hasScope(payload,"ha.read")) return unauthorized(request);
  let body:any; try { body = await request.json(); } catch { return NextResponse.json(jsonRpcError(null,-32700,"Parse error"),{status:400}); }
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m)=>handleRpc(m,payload)))).filter(Boolean);
    return NextResponse.json(responses);
  }
  const response = await handleRpc(body,payload);
  if (response === null) return new NextResponse(null,{status:202});
  return NextResponse.json(response);
}

export async function GET(request: Request) {
  const payload = bearerPayload(request);
  if (!payload || !hasScope(payload,"ha.read")) return unauthorized(request);
  return NextResponse.json({name:"Dover Home Assistant Bridge",status:"ok"});
}
