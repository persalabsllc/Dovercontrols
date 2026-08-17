# Dover Controls

Dover Controls is a responsive residential operations dashboard prototype for a future Home Assistant installation. It includes a secure-access visual entry screen, an interactive simulation dashboard, and planned locations for UniFi, ecobee, Kasa, cameras, security, and utility monitoring.

## Prototype status

- The interface and simulated controls are functional.
- No Home Assistant instance or physical devices are connected.
- The on-screen sign-in form is a visual prototype, not production authentication.
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

Import this repository into Vercel as a Next.js project. The prototype does not require environment variables. Add production authentication, server-side Home Assistant credentials, and the `DoverControls.com` domain before treating it as a live control surface.
