# Dover Controls

Dover Controls is a responsive residential operations dashboard for the Dover residence. It includes Firebase email/password authentication, an authenticated server-only bridge to Home Assistant, live ecobee climate telemetry and target control, and simulation-only previews for systems that have not been commissioned.

## Prototype status

- The interface and simulated controls are functional.
- The ecobee climate view can read state and set a target through Home Assistant.
- The dashboard requires a Firebase Authentication account.
- Public account registration is intentionally not available.
- Sessions last for the current browser tab by default. Users can explicitly choose to remember a trusted device.
- Simulated lighting, security, and scene state is stored only in the browser.

Never place Home Assistant long-lived access tokens or device credentials in browser code or committed environment files. The browser sends a short-lived Firebase ID token only to a same-origin API route. That route verifies the operator allowlist, uses an exact climate entity allowlist, and keeps the Home Assistant credential on the server.

## Local development

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Create `.env.local` from `.env.example` for bridge testing. `HA_BASE_URL` must be the root `https://…ui.nabu.casa/` remote-access URL. `DOVER_ALLOWED_FIREBASE_EMAILS` is required and must contain the exact Firebase login email permitted to operate the thermostat.

## Validation

```bash
npm run lint
npm run build
```

## Vercel

Import this repository into Vercel as a Next.js project. The Firebase web configuration is public client configuration and is included in the application. Before signing in, enable the Email/Password provider in Firebase Authentication and create the authorized owner account.

Configure these server-only environment variables as sensitive values:

- `HA_BASE_URL`
- `HA_ACCESS_TOKEN`
- `DOVER_ALLOWED_FIREBASE_EMAILS`
- `HA_CLIMATE_ENTITY_ID` (optional; defaults to the exact allowlisted entity `climate.dover_house`)

The climate API fails closed if the operator allowlist is absent. It accepts only a numeric `temperature` request, limits commands per authenticated operator, and never accepts a Home Assistant entity ID or service name from the browser.
