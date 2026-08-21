# Dover Controls

Dover Controls is a responsive residential operations dashboard for the Dover residence. It includes Firebase email/password authentication, owner-managed operator access, an authenticated server-only bridge to Home Assistant, and live ecobee climate telemetry and control.

## Prototype status

- The interface and simulated controls are functional.
- The ecobee climate view can read state and set a target through Home Assistant.
- The dashboard requires a Firebase Authentication account.
- Public account registration is intentionally not available.
- The owner can create, disable, update, reset, and remove operator accounts from the dashboard.
- Access roles are `owner`, `operator`, and `viewer`; roles live in Firebase Authentication custom claims rather than per-user environment variables.
- Sessions last for the current browser tab by default. Users can explicitly choose to remember a trusted device.

Never place Home Assistant long-lived access tokens, the Firebase service-account JSON, or device credentials in browser code or committed environment files. The browser sends a short-lived Firebase ID token only to same-origin API routes. Those routes verify the operator role, use an exact climate entity allowlist, and keep privileged credentials on the server.

## Local development

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Create `.env.local` from `.env.example` for bridge testing. `HA_BASE_URL` must be the root `https://…ui.nabu.casa/` remote-access URL.

## Firebase operator management

The user directory is backed by Firebase Authentication. One server credential manages every account; do not create an environment variable for each person.

One-time setup:

1. In Firebase Authentication, enable the Email/Password provider and create the `kkratoville@gmail.com` owner account if it does not already exist.
2. In Google Cloud IAM, create a dedicated service account for this Vercel project and grant it the **Firebase Authentication Admin** role (`roles/firebaseauth.admin`).
3. Create a JSON key for that service account and store the complete JSON document in the server-only `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` environment variable.
4. Set `DOVER_BOOTSTRAP_OWNER_EMAIL` to the exact owner email and redeploy.

On the owner’s first authorized request, the server bootstraps the permanent `owner` custom claim. The owner can then add `operator` or `viewer` accounts in the dashboard, disable or remove them, change their roles and names, assign an initial or replacement password, or send a Firebase password-reset email. Passwords are accepted only by Firebase over the server API and are never returned or logged by Dover Controls. The bootstrap owner cannot be disabled, demoted, reset by another operator, or deleted through these routes. New users should change an owner-assigned initial password after their first sign-in.

`DOVER_ALLOWED_FIREBASE_EMAILS` remains an optional, comma-separated migration fallback for older accounts without a role claim. Remove entries after those accounts have been assigned roles through the owner dashboard.

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
- `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`
- `DOVER_BOOTSTRAP_OWNER_EMAIL` (defaults to the Dover owner address)
- `HA_CLIMATE_ENTITY_ID` (optional; defaults to the exact allowlisted entity `climate.dover_house`)
- `DOVER_ALLOWED_FIREBASE_EMAILS` (optional legacy migration fallback)

The operator API fails closed for accounts without a valid role (or explicit legacy fallback). Owner-only mutations validate the same origin and a strict request schema, protect the bootstrap owner, never disclose passwords, and revoke existing sessions after password or status changes. Role changes are enforced on the next server request. The climate API never accepts a Home Assistant entity ID or service name from the browser.
