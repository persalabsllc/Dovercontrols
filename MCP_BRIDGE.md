# Dover Home Assistant MCP Bridge

This branch adds a server-side MCP bridge for ChatGPT to inspect and, where permitted by the ChatGPT workspace, control Home Assistant.

## Required Vercel environment variables

- `MCP_BRIDGE_SECRET` — long random signing secret for bridge authorization codes/tokens.
- `MCP_ADMIN_PASSWORD` — operator password used only on the bridge authorization screen.
- Existing `HA_BASE_URL` and `HA_ACCESS_TOKEN` are reused for server-to-server Home Assistant API access.

## Safety defaults

The bridge exposes read tools and an allowlisted set of Home Assistant service calls. Security-sensitive and infrastructure actions remain disabled unless explicitly enabled:

- `MCP_ALLOW_SECURITY_WRITES=true` enables lock/unlock actions.
- `MCP_ALLOW_INFRASTRUCTURE_WRITES=true` enables approved infrastructure button presses such as PoE power-cycle actions.

Do not prefix bridge secrets or Home Assistant credentials with `NEXT_PUBLIC_`.
