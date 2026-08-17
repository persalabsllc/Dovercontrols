# Dover Controls

Dover Controls is a responsive residential operations dashboard prototype for a future Home Assistant installation. It includes Firebase email/password authentication, an interactive simulation dashboard, and planned locations for UniFi, ecobee, Kasa, cameras, security, and utility monitoring.

## Prototype status

- The interface and simulated controls are functional.
- No Home Assistant instance or physical devices are connected.
- The dashboard requires a Firebase Authentication account.
- Public account registration is intentionally not available.
- Sessions last for the current browser tab by default. Users can explicitly choose to remember a trusted device.
- Simulated lighting, climate, security, and scene state is stored only in the browser.

Never place Home Assistant long-lived access tokens or device credentials in browser code or committed environment files. Production authentication and the Home Assistant connection should be implemented server-side.

## Local development

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validation

```bash
npm run lint
npm run build
```

## Vercel

Import this repository into Vercel as a Next.js project. The Firebase web configuration is public client configuration and is included in the application. Before signing in, enable the Email/Password provider in Firebase Authentication and create the authorized owner account. Add server-side Home Assistant credentials and the `DoverControls.com` domain before treating it as a live control surface.

Firebase Authentication currently protects access to the simulated dashboard UI. Before live Home Assistant access, the server must also verify the signed-in user's Firebase ID token and an approved UID or custom role before returning home data or accepting a device command.
