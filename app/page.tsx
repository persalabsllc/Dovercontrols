"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FirebaseError } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { UserManagementView } from "@/components/UserManagementView";
import type {
  ClimateCommand,
  ClimateCommandResult,
  ClimateSnapshot,
} from "@/lib/climate-types";
import { getFirebaseAuth } from "@/lib/firebase";
import type { OperatorSession } from "@/lib/operator-types";

type View =
  | "overview"
  | "mission"
  | "security"
  | "climate"
  | "lighting"
  | "network"
  | "cameras"
  | "utilities"
  | "connections"
  | "users"
  | "settings";

type LightId = "living" | "kitchen" | "bedroom" | "exterior";

type DemoState = {
  lights: Record<LightId, boolean>;
  scene: "Home" | "Away" | "Night" | "All Off";
  securityMode: "Standby" | "Armed";
};

type HomeAssistantConnection = "checking" | "connected" | "unavailable";

const STORAGE_KEY = "dover-controls-preview-v1";

const initialDemoState: DemoState = {
  lights: { living: true, kitchen: true, bedroom: false, exterior: false },
  scene: "Home",
  securityMode: "Standby",
};

const navItems: Array<{ id: View; code: string; label: string }> = [
  { id: "overview", code: "OV", label: "Overview" },
  { id: "mission", code: "MC", label: "Mission Control" },
  { id: "security", code: "SC", label: "Security" },
  { id: "climate", code: "CL", label: "Climate" },
  { id: "lighting", code: "LT", label: "Lighting" },
  { id: "network", code: "NW", label: "Network" },
  { id: "cameras", code: "CM", label: "Cameras" },
  { id: "utilities", code: "UT", label: "Utilities" },
  { id: "connections", code: "CN", label: "Connections" },
];

const lightLabels: Record<LightId, string> = {
  living: "Living room",
  kitchen: "Kitchen",
  bedroom: "Primary bedroom",
  exterior: "Exterior",
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "brand-lockup--compact" : ""}`}>
      <div className="brand-mark" aria-hidden="true"><span>D</span><i /></div>
      <div><strong>Dover Controls</strong>{!compact && <small>Secure Operations Gateway</small>}</div>
    </div>
  );
}

function StatusDot({ tone = "cyan" }: { tone?: "cyan" | "green" | "amber" }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

function MiniStatus({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "green" | "amber" }) {
  return <div className="mini-status"><span>{label}</span><strong><StatusDot tone={tone} />{value}</strong></div>;
}

type AuthAction = "signin" | "reset";
type AccountAction = "reset" | "logout";

function getOperatorIdentity(user: User): { displayName: string; initials: string } {
  const emailName = user.email?.split("@")[0] ?? "";
  const fallbackName = emailName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const displayName = user.displayName?.trim() || fallbackName || "Authorized operator";
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`
    : displayName.slice(0, 2);

  return { displayName, initials: initials.toUpperCase() };
}

function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return "Authentication is temporarily unavailable. Please try again.";
  }

  switch (error.code) {
    case "auth/invalid-credential":
    case "auth/invalid-email":
      return "The email address or password is incorrect.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact the system owner.";
    case "auth/too-many-requests":
      return "Too many attempts were made. Wait a moment and try again.";
    case "auth/network-request-failed":
      return "The authentication service could not be reached. Check your connection.";
    case "auth/operation-not-allowed":
      return "Email and password access is not currently available.";
    default:
      return "Unable to authenticate. Verify your credentials and try again.";
  }
}

function getAccountActionErrorMessage(error: unknown, action: AccountAction): string {
  if (error instanceof FirebaseError && error.code === "auth/network-request-failed") {
    return "The identity service could not be reached. Check your connection and try again.";
  }

  return action === "reset"
    ? "The password-change email could not be sent. Please try again."
    : "The secure session could not be ended. Please try again.";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isClimateSnapshot(value: unknown): value is ClimateSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClimateSnapshot>;
  return (
    typeof candidate.available === "boolean" &&
    typeof candidate.name === "string" &&
    isNullableNumber(candidate.currentTemperature) &&
    isNullableNumber(candidate.targetTemperature) &&
    isNullableNumber(candidate.targetTemperatureLow) &&
    isNullableNumber(candidate.targetTemperatureHigh) &&
    isNullableNumber(candidate.humidity) &&
    typeof candidate.hvacMode === "string" &&
    isStringArray(candidate.hvacModes) &&
    isNullableString(candidate.hvacAction) &&
    isNullableString(candidate.fanMode) &&
    isStringArray(candidate.fanModes) &&
    isNullableString(candidate.presetMode) &&
    isStringArray(candidate.presetModes) &&
    isNullableString(candidate.scheduleMode) &&
    isStringArray(candidate.scheduleModes) &&
    typeof candidate.temperatureUnit === "string" &&
    typeof candidate.temperatureStep === "number" &&
    typeof candidate.minTemperature === "number" &&
    typeof candidate.maxTemperature === "number" &&
    !!candidate.capabilities &&
    typeof candidate.capabilities === "object" &&
    typeof candidate.capabilities.setTemperature === "boolean" &&
    typeof candidate.capabilities.setTemperatureRange === "boolean" &&
    typeof candidate.capabilities.setHvacMode === "boolean" &&
    typeof candidate.capabilities.setFanMode === "boolean" &&
    typeof candidate.capabilities.setPresetMode === "boolean" &&
    typeof candidate.capabilities.setScheduleMode === "boolean" &&
    typeof candidate.capabilities.clearHold === "boolean" &&
    isNullableString(candidate.updatedAt)
  );
}

function isClimateCommandResult(value: unknown): value is ClimateCommandResult {
  if (!isClimateSnapshot(value)) return false;
  const command = (value as Partial<ClimateCommandResult>).command;
  return (
    !!command &&
    typeof command === "object" &&
    [
      "set_temperature",
      "set_hvac_mode",
      "set_fan_mode",
      "set_preset_mode",
      "set_schedule_mode",
      "clear_hold",
    ].includes(command.action) &&
    (command.status === "confirmed" || command.status === "accepted")
  );
}

function isOperatorSession(value: unknown): value is OperatorSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OperatorSession>;
  return (
    typeof candidate.uid === "string" &&
    typeof candidate.email === "string" &&
    isNullableString(candidate.displayName) &&
    (candidate.role === "owner" || candidate.role === "operator" || candidate.role === "viewer")
  );
}

async function climateApiResponse(
  user: User,
  init: RequestInit = {},
): Promise<Response> {
  async function execute(forceRefresh: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await user.getIdToken(forceRefresh)}`);
    if (init.body) headers.set("Content-Type", "application/json");

    return fetch("/api/home-assistant/climate", {
      ...init,
      headers,
      cache: "no-store",
    });
  }

  let response = await execute(false);
  if (response.status === 401) response = await execute(true);
  if (!response.ok) throw new Error("Home Assistant bridge request failed");
  return response;
}

async function climateRequest(user: User): Promise<ClimateSnapshot> {
  const response = await climateApiResponse(user);
  const payload = (await response.json()) as unknown;
  if (!isClimateSnapshot(payload)) throw new Error("Home Assistant bridge returned invalid data");
  return payload;
}

async function climateCommandRequest(
  user: User,
  command: ClimateCommand,
): Promise<ClimateCommandResult> {
  const response = await climateApiResponse(user, {
    method: "PATCH",
    body: JSON.stringify(command),
  });
  const payload = (await response.json()) as unknown;
  if (!isClimateCommandResult(payload)) {
    throw new Error("Home Assistant bridge returned an invalid command result");
  }
  return payload;
}

class SessionAuthorizationError extends Error {
  constructor(public readonly status: number) {
    super("session_authorization_failed");
    this.name = "SessionAuthorizationError";
  }
}

async function operatorSessionRequest(user: User): Promise<OperatorSession> {
  async function execute(forceRefresh: boolean): Promise<Response> {
    return fetch("/api/operator/me", {
      headers: { Authorization: `Bearer ${await user.getIdToken(forceRefresh)}` },
      cache: "no-store",
    });
  }

  let response = await execute(false);
  if (response.status === 401) response = await execute(true);
  if (!response.ok) throw new SessionAuthorizationError(response.status);

  const payload = (await response.json()) as { user?: unknown };
  if (!isOperatorSession(payload.user)) throw new SessionAuthorizationError(503);
  return payload.user;
}

function temperaturePrecision(step: number): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const normalized = safeStep.toFixed(4).replace(/0+$/, "");
  const decimalIndex = normalized.indexOf(".");
  return decimalIndex === -1 ? 0 : normalized.length - decimalIndex - 1;
}

function roundedTemperature(value: number | null, step = 1): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(temperaturePrecision(step))));
}

function formatSystemState(value: string | null): string {
  if (!value) return "Unknown";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function LoginScreen({ initialMessage = "" }: { initialMessage?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [busyAction, setBusyAction] = useState<AuthAction | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setMessageTone("error");
      setMessage("Enter both your email address and password.");
      return;
    }

    setBusyAction("signin");
    setMessage("");
    try {
      const auth = getFirebaseAuth();
      await setPersistence(auth, rememberDevice ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      setMessageTone("error");
      setMessage(getAuthErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessageTone("error");
      setMessage("Enter your email address first, then request a password reset.");
      return;
    }

    setBusyAction("reset");
    setMessage("");
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
      setMessageTone("success");
      setMessage("If an authorized account exists, password reset instructions have been sent.");
    } catch (error) {
      if (error instanceof FirebaseError && (error.code === "auth/user-not-found" || error.code === "auth/user-disabled")) {
        setMessageTone("success");
        setMessage("If an authorized account exists, password reset instructions have been sent.");
      } else {
        setMessageTone("error");
        setMessage(getAuthErrorMessage(error));
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="login-shell">
      <div className="atmosphere atmosphere--one" />
      <div className="atmosphere atmosphere--two" />
      <div className="secure-grid" />
      <header className="login-header">
        <BrandMark />
        <div className="prototype-pill prototype-pill--secure"><StatusDot tone="green" /> Restricted / Authorization Required</div>
      </header>

      <div className="login-main">
        <section className="access-panel" aria-label="Secure sign in">
          <div className="access-panel__topline">
            <div><span className="section-kicker">Authorized access</span><h2>Restricted gateway</h2></div>
            <div className="access-glyph" aria-hidden="true"><i /></div>
          </div>
          <div className="notice notice--secure"><StatusDot tone="green" /><div><strong>Identity verification required</strong><span>System details are withheld until authentication.</span></div></div>

          <form onSubmit={submit} className="access-form">
            <label htmlFor="email">Operator email</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@dovercontrols.com" autoComplete="email" disabled={busyAction !== null} required aria-invalid={messageTone === "error" && message.length > 0} />
            <div className="password-label">
              <label htmlFor="password">Access passphrase</label>
              <button className="text-button" type="button" onClick={() => setShowPassword((value) => !value)} disabled={busyAction !== null}>{showPassword ? "Hide" : "Show"}</button>
            </div>
            <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter passphrase" autoComplete="current-password" disabled={busyAction !== null} required aria-invalid={messageTone === "error" && message.length > 0} />
            <div className="access-form__options">
              <label className="remember-control"><input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} disabled={busyAction !== null} /><span>Remember this device</span></label>
              <button className="text-button" type="button" onClick={resetPassword} disabled={busyAction !== null}>{busyAction === "reset" ? "Sending…" : "Forgot password?"}</button>
            </div>
            {message && <p className={`form-message form-message--${messageTone}`} role="status" aria-live="polite">{message}</p>}
            <button type="submit" className="primary-button" disabled={busyAction !== null} aria-busy={busyAction === "signin"}><span>{busyAction === "signin" ? "Authenticating…" : "Authenticate"}</span><span aria-hidden="true">→</span></button>
          </form>
          <p className="privacy-note">No public registration. Authorized identities only.</p>
          <div className="terminal-strip">
            <MiniStatus label="Node" value="READY" tone="green" />
            <MiniStatus label="Identity service" value="ONLINE" tone="green" />
            <MiniStatus label="Protected services" value="RESTRICTED" tone="amber" />
          </div>
        </section>
      </div>
      <footer className="login-footer">
        <div className="login-footer__meta"><span>Restricted interface · Authorized identities only</span><span>Identity verification / Restricted access</span></div>
        <p className="access-warning"><strong>Restricted system notice //</strong> Access activity is subject to logging, attribution, and retention. Unauthorized access, attempted intrusion, or misuse may be referred to appropriate authorities for investigation and prosecution to the fullest extent permitted by law.</p>
      </footer>
    </main>
  );
}

function AuthLoadingScreen() {
  return (
    <main className="login-shell auth-loading-shell">
      <div className="atmosphere atmosphere--one" />
      <div className="atmosphere atmosphere--two" />
      <div className="secure-grid" />
      <header className="login-header"><BrandMark /><div className="prototype-pill"><StatusDot tone="cyan" /> Verifying session</div></header>
      <section className="auth-loading" role="status" aria-live="polite">
        <div className="auth-loading__ring" aria-hidden="true"><span /></div>
        <span className="section-kicker">Secure session</span>
        <h1>Verifying authorization</h1>
        <p>Establishing a secure identity session.</p>
      </section>
    </main>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

function PanelHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="panel-heading"><div>{eyebrow && <span className="section-kicker">{eyebrow}</span>}<h3>{title}</h3></div>{action}</div>;
}

function StateBadge({ children, tone = "pending" }: { children: ReactNode; tone?: "ready" | "pending" | "sample" }) {
  return <span className={`state-badge state-badge--${tone}`}>{children}</span>;
}

function EmptyCamera({ name }: { name: string }) {
  return (
    <div className="camera-frame">
      <div className="camera-corners" /><div className="camera-scan" />
      <div className="camera-empty"><div className="camera-icon"><span /></div><strong>Awaiting video source</strong><span>{name}</span></div>
      <div className="camera-meta"><span>NO SIGNAL</span><span>CAM / PENDING</span></div>
    </div>
  );
}

function ConnectionRow({ code, name, detail, ready = false }: { code: string; name: string; detail: string; ready?: boolean }) {
  return <div className="connection-row"><div className={`connection-icon ${ready ? "connection-icon--ready" : ""}`}>{code}</div><div><strong>{name}</strong><span>{detail}</span></div><StateBadge tone={ready ? "ready" : "pending"}>{ready ? "Ready" : "Awaiting HA"}</StateBadge></div>;
}

function QuickScenes({ current, onSelect }: { current: DemoState["scene"]; onSelect: (scene: DemoState["scene"]) => void }) {
  const scenes: Array<{ name: DemoState["scene"]; code: string; detail: string }> = [
    { name: "Home", code: "HM", detail: "Comfort preset" },
    { name: "Away", code: "AW", detail: "Secure & conserve" },
    { name: "Night", code: "NT", detail: "Evening profile" },
    { name: "All Off", code: "00", detail: "Lighting shutdown" },
  ];
  return <div className="scene-grid">{scenes.map((scene) => <button className={`scene-button ${current === scene.name ? "scene-button--active" : ""}`} key={scene.name} type="button" onClick={() => onSelect(scene.name)}><span className="scene-code">{scene.code}</span><span><strong>{scene.name}</strong><small>{scene.detail}</small></span></button>)}</div>;
}

function Overview({ state, climate, connection, onScene, onNavigate }: { state: DemoState; climate: ClimateSnapshot | null; connection: HomeAssistantConnection; onScene: (scene: DemoState["scene"]) => void; onNavigate: (view: View) => void }) {
  const lightsOn = Object.values(state.lights).filter(Boolean).length;
  const climateLive = connection === "connected" && climate?.available === true;
  const temperatureStep = climate?.temperatureStep ?? 1;
  const temperatureUnit = climate?.temperatureUnit ?? "°F";
  const currentTemperature = roundedTemperature(
    climateLive ? climate.currentTemperature : null,
    temperatureStep,
  );
  const targetTemperature = roundedTemperature(
    climateLive ? climate.targetTemperature : null,
    temperatureStep,
  );
  const targetSummary = climateLive &&
    climate.hvacMode === "heat_cool" &&
    climate.targetTemperatureLow !== null &&
    climate.targetTemperatureHigh !== null
    ? `${roundedTemperature(climate.targetTemperatureLow, temperatureStep)}${temperatureUnit}–${roundedTemperature(climate.targetTemperatureHigh, temperatureStep)}${temperatureUnit}`
    : targetTemperature === "—" ? "—" : `${targetTemperature}${temperatureUnit}`;
  const humidity = climateLive && climate.humidity !== null ? `${Math.round(climate.humidity)}%` : "—";
  return (
    <div className="dashboard-content">
      <div className="overview-grid">
        <Panel className="command-panel">
          <div className="command-copy"><span className="section-kicker">Residence status / Commissioning</span><h2>{climateLive ? "Home Assistant link established" : "Connecting to Home Assistant"}</h2><p>{climateLive ? "Dover Controls is receiving live ecobee telemetry through the protected control bridge." : "The portal is online. Live climate telemetry will appear when the protected bridge responds."}</p><button className="link-button" type="button" onClick={() => onNavigate("connections")}>Review connection status <span aria-hidden="true">→</span></button></div>
          <div className="command-core" aria-hidden="true"><div className="core-ring core-ring--outer" /><div className="core-ring core-ring--inner" /><div className="core-center"><span>DC</span><small>READY</small></div><i className="core-node core-node--one" /><i className="core-node core-node--two" /><i className="core-node core-node--three" /></div>
          <div className="command-footer"><span><StatusDot tone="green" /> Portal online</span><span><StatusDot tone={climateLive ? "green" : "amber"} /> HA link {climateLive ? "live" : "pending"}</span><span><StatusDot tone={climateLive ? "green" : "amber"} /> ecobee {climateLive ? "live" : "pending"}</span></div>
        </Panel>
        <Panel className="scenes-panel"><PanelHeading eyebrow="Preview controls" title="Quick scenes" action={<StateBadge tone="sample">Demo</StateBadge>} /><QuickScenes current={state.scene} onSelect={onScene} /></Panel>
      </div>

      <div className="metric-grid">
        <button className="metric-card" type="button" onClick={() => onNavigate("security")}><span className="metric-top"><span className="metric-code">SC</span><StateBadge>Awaiting</StateBadge></span><strong>Security</strong><span className="metric-value">Standby</span><small>Sensors not commissioned</small><i className="metric-line" /></button>
        <button className="metric-card" type="button" onClick={() => onNavigate("climate")}><span className="metric-top"><span className="metric-code">CL</span><StateBadge tone={climateLive ? "ready" : "pending"}>{climateLive ? "Live" : connection === "checking" ? "Connecting" : "Unavailable"}</StateBadge></span><strong>Climate</strong><span className="metric-value">{currentTemperature}<span>{temperatureUnit}</span></span><small>Target {targetSummary} · Humidity {humidity}</small><i className="metric-line metric-line--cyan" /></button>
        <button className="metric-card" type="button" onClick={() => onNavigate("lighting")}><span className="metric-top"><span className="metric-code">LT</span><StateBadge tone="sample">Interactive</StateBadge></span><strong>Lighting</strong><span className="metric-value">{lightsOn}<span>/4</span></span><small>Demo circuits active</small><i className="metric-line metric-line--green" /></button>
        <button className="metric-card" type="button" onClick={() => onNavigate("network")}><span className="metric-top"><span className="metric-code">NW</span><StateBadge>Awaiting</StateBadge></span><strong>Network</strong><span className="metric-value metric-value--word">UniFi</span><small>Controller connection pending</small><i className="metric-line" /></button>
      </div>

      <div className="lower-grid">
        <Panel className="camera-panel"><PanelHeading eyebrow="Property view" title="Camera grid" action={<button className="text-button" type="button" onClick={() => onNavigate("cameras")}>All cameras →</button>} /><div className="camera-grid camera-grid--overview"><EmptyCamera name="Front approach" /><EmptyCamera name="Rear perimeter" /></div></Panel>
        <Panel className="connections-panel"><PanelHeading eyebrow="Control plane" title="Connection center" action={<button className="text-button" type="button" onClick={() => onNavigate("connections")}>Manage →</button>} /><div className="connection-list"><ConnectionRow code="DC" name="Dover portal" detail="Interface layer" ready /><ConnectionRow code="HA" name="Home Assistant" detail="Protected remote bridge" ready={connection === "connected"} /><ConnectionRow code="EC" name="ecobee" detail={climateLive ? "Live climate telemetry" : "Climate entity pending"} ready={climateLive} /></div></Panel>
      </div>

      <div className="lower-grid lower-grid--utilities">
        <Panel><PanelHeading eyebrow="Future expansion" title="Home utilities" action={<StateBadge>Planned</StateBadge>} /><div className="utility-list">{[["WP", "Water pressure", "Sensor not installed"], ["HW", "Hot water", "Temperature monitor planned"], ["LK", "Leak protection", "Valve controller planned"], ["PW", "Power", "Energy monitoring planned"]].map(([code, name, detail]) => <div className="utility-item" key={code}><span>{code}</span><div><strong>{name}</strong><small>{detail}</small></div><i /></div>)}</div></Panel>
        <Panel><PanelHeading eyebrow="System log" title="Recent activity" /><div className="activity-list"><div><span className="activity-time">NOW</span><i className="activity-dot activity-dot--green" /><p><strong>{climateLive ? "ecobee climate link active" : "Portal interface ready"}</strong><small>{climateLive ? "Live Home Assistant telemetry secured" : "Waiting for the Home Assistant bridge"}</small></p></div><div><span className="activity-time">NEXT</span><i className="activity-dot" /><p><strong>Validate two-way climate control</strong><small>Confirm one target-temperature command at the thermostat</small></p></div><div><span className="activity-time">LATER</span><i className="activity-dot" /><p><strong>Connect remaining residence systems</strong><small>UniFi Protect and compatible lighting</small></p></div></div></Panel>
      </div>
    </div>
  );
}

function DetailIntro({ code, eyebrow, title, description, badge = "Awaiting connection", badgeTone = "pending" }: { code: string; eyebrow: string; title: string; description: string; badge?: string; badgeTone?: "ready" | "pending" | "sample" }) {
  return <Panel className="detail-intro"><div className="detail-code">{code}</div><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><StateBadge tone={badgeTone}>{badge}</StateBadge></Panel>;
}

function SecurityView({ state, onArm }: { state: DemoState; onArm: () => void }) {
  return <div className="dashboard-content"><DetailIntro code="SC" eyebrow="Security domain" title="Property protection" description="One view for access, occupancy, perimeter monitoring, and future alarm controls." /><div className="detail-grid detail-grid--wide"><Panel><PanelHeading eyebrow="Preview mode" title="Security posture" action={<StateBadge tone="sample">Simulation</StateBadge>} /><div className="security-posture"><div className={`shield-visual ${state.securityMode === "Armed" ? "shield-visual--armed" : ""}`}><span>{state.securityMode === "Armed" ? "ARMED" : "STANDBY"}</span></div><div><span className="section-kicker">Current preview state</span><strong>{state.securityMode}</strong><p>No door, window, motion, or alarm entities have been commissioned.</p><button className="primary-button primary-button--compact" type="button" onClick={onArm}>{state.securityMode === "Armed" ? "Return to standby" : "Preview away arming"}</button></div></div></Panel><Panel><PanelHeading eyebrow="Planned zones" title="Sensor matrix" /><div className="zone-list">{[["Entry points", "Door and window contacts"], ["Interior", "Occupancy and motion"], ["Perimeter", "Exterior camera events"], ["Life safety", "Smoke, CO, and water"]].map(([name, detail], index) => <div className="zone-row" key={name}><span>0{index + 1}</span><div><strong>{name}</strong><small>{detail}</small></div><StateBadge>Planned</StateBadge></div>)}</div></Panel></div></div>;
}

type ClimateBusyAction = ClimateCommand["action"] | null;

function climateOptionLabel(value: string): string {
  if (value === "on") return "On (hold)";
  if (value === "heat_cool") return "Auto heat/cool";
  return formatSystemState(value);
}

function adjustedTemperature(value: number, direction: -1 | 1, step: number): number {
  return Number((value + direction * step).toFixed(temperaturePrecision(step)));
}

function canAdjustTemperature(
  value: number,
  direction: -1 | 1,
  step: number,
  minimum: number,
  maximum: number,
): boolean {
  const candidate = adjustedTemperature(value, direction, step);
  return candidate >= minimum - 0.000_001 && candidate <= maximum + 0.000_001;
}

function ClimateSegmentedControl({ label, options, value, disabled, onSelect }: { label: string; options: string[]; value: string | null; disabled: boolean; onSelect: (value: string) => void }) {
  return (
    <fieldset className="climate-segmented-control" disabled={disabled}>
      <legend>{label}</legend>
      {options.length > 0 ? (
        <div className="climate-segments">
          {options.map((option) => (
            <button key={option} type="button" aria-pressed={value === option} onClick={() => onSelect(option)}>
              {climateOptionLabel(option)}
            </button>
          ))}
        </div>
      ) : <p className="climate-capability-empty">Not exposed by Home Assistant.</p>}
    </fieldset>
  );
}

function ClimateView({ climate, connection, busyAction, readOnly, onCommand }: { climate: ClimateSnapshot | null; connection: HomeAssistantConnection; busyAction: ClimateBusyAction; readOnly: boolean; onCommand: (command: ClimateCommand) => void }) {
  const live = connection === "connected" && climate?.available === true;
  const target = live ? climate.targetTemperature : null;
  const current = live ? climate.currentTemperature : null;
  const humidity = live ? climate.humidity : null;
  const controlsDisabled = !live || readOnly || busyAction !== null;
  const mode = live ? formatSystemState(climate.hvacMode) : "Unavailable";
  const action = live ? formatSystemState(climate.hvacAction) : "No live state";
  const unit = climate?.temperatureUnit ?? "°F";
  const step = Math.max(0.1, climate?.temperatureStep ?? 1);
  const minimum = climate?.minTemperature ?? 60;
  const maximum = climate?.maxTemperature ?? 80;
  const rangeMode = live && climate.hvacMode === "heat_cool";
  const hasRangeTargets = rangeMode &&
    climate.targetTemperatureLow !== null &&
    climate.targetTemperatureHigh !== null;
  const rangeControlsDisabled = controlsDisabled || !climate?.capabilities.setTemperatureRange;

  return (
    <div className="dashboard-content">
      <DetailIntro code="CL" eyebrow="Climate domain" title="Whole-home comfort" description="Live ecobee temperature, humidity, operating state, and target control through Home Assistant." badge={live ? "ecobee live" : connection === "checking" ? "Connecting" : "Bridge unavailable"} badgeTone={live ? "ready" : "pending"} />
      <div className="detail-grid detail-grid--wide">
        <Panel className="thermostat-panel">
          <PanelHeading eyebrow="Home Assistant climate" title={climate?.name ?? "Dover House"} action={<StateBadge tone={live ? "ready" : "pending"}>{live ? "Live data" : "Unavailable"}</StateBadge>} />
          <div className="thermostat">
            <div className="temperature-ring"><div><small>Indoor</small><strong>{roundedTemperature(current, step)}<span>{unit}</span></strong><em>{humidity === null ? "— humidity" : `${Math.round(humidity)}% humidity`}</em></div></div>
            <div className="temperature-controls">
              <span className="section-kicker">Comfort target</span>
              {hasRangeTargets ? (
                <div className="temperature-range-controls">
                  <div><small>Heat to</small><span><button type="button" aria-label="Lower heating target" disabled={rangeControlsDisabled || !canAdjustTemperature(climate.targetTemperatureLow!, -1, step, minimum, climate.targetTemperatureHigh!)} onClick={() => onCommand({ action: "set_temperature", targetLow: adjustedTemperature(climate.targetTemperatureLow!, -1, step), targetHigh: climate.targetTemperatureHigh! })}>−</button><strong>{roundedTemperature(climate.targetTemperatureLow, step)}{unit}</strong><button type="button" aria-label="Raise heating target" disabled={rangeControlsDisabled || !canAdjustTemperature(climate.targetTemperatureLow!, 1, step, minimum, climate.targetTemperatureHigh!)} onClick={() => onCommand({ action: "set_temperature", targetLow: adjustedTemperature(climate.targetTemperatureLow!, 1, step), targetHigh: climate.targetTemperatureHigh! })}>+</button></span></div>
                  <div><small>Cool to</small><span><button type="button" aria-label="Lower cooling target" disabled={rangeControlsDisabled || !canAdjustTemperature(climate.targetTemperatureHigh!, -1, step, climate.targetTemperatureLow!, maximum)} onClick={() => onCommand({ action: "set_temperature", targetLow: climate.targetTemperatureLow!, targetHigh: adjustedTemperature(climate.targetTemperatureHigh!, -1, step) })}>−</button><strong>{roundedTemperature(climate.targetTemperatureHigh, step)}{unit}</strong><button type="button" aria-label="Raise cooling target" disabled={rangeControlsDisabled || !canAdjustTemperature(climate.targetTemperatureHigh!, 1, step, climate.targetTemperatureLow!, maximum)} onClick={() => onCommand({ action: "set_temperature", targetLow: climate.targetTemperatureLow!, targetHigh: adjustedTemperature(climate.targetTemperatureHigh!, 1, step) })}>+</button></span></div>
                </div>
              ) : rangeMode ? (
                <p className="climate-capability-empty">Waiting for Home Assistant to report both automatic heat and cool targets.</p>
              ) : (
                <div><button type="button" aria-label="Lower target temperature" disabled={controlsDisabled || target === null || !climate?.capabilities.setTemperature || !canAdjustTemperature(target, -1, step, minimum, maximum)} onClick={() => { if (target !== null) onCommand({ action: "set_temperature", temperature: adjustedTemperature(target, -1, step) }); }}>−</button><strong>{roundedTemperature(target, step)}{unit}</strong><button type="button" aria-label="Raise target temperature" disabled={controlsDisabled || target === null || !climate?.capabilities.setTemperature || !canAdjustTemperature(target, 1, step, minimum, maximum)} onClick={() => { if (target !== null) onCommand({ action: "set_temperature", temperature: adjustedTemperature(target, 1, step) }); }}>+</button></div>
              )}
              <p>HVAC mode <strong>{mode}</strong></p>
              <small aria-live="polite">{busyAction ? `Sending ${formatSystemState(busyAction)} command…` : readOnly ? "Viewer access — controls are read-only." : live ? `Current action: ${action}` : "No command was sent."}</small>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeading eyebrow="Room sensors" title="Comfort zones" />
          <div className="room-list">{[["Living room", `${roundedTemperature(current, step)}${unit}`, humidity === null ? "—" : `${Math.round(humidity)}%`], ["Primary bedroom", "—", "—"], ["Lower level", "—", "—"]].map(([name, temp, roomHumidity], index) => <div className="room-row" key={name}><span>0{index + 1}</span><strong>{name}</strong><div><b>{temp}</b><small>{roomHumidity} RH</small></div></div>)}</div>
          <div className="device-note"><StatusDot tone={live ? "green" : "amber"} /><p><strong>{live ? "ecobee connected locally" : "ecobee link unavailable"}</strong><span>{live ? "State is refreshed every 15 seconds through the protected server bridge." : "Controls are disabled until a verified live state returns."}</span></p></div>
        </Panel>
      </div>
      <Panel className="climate-operations-panel">
        <PanelHeading eyebrow="Thermostat operations" title="Mode, fan, and schedule" action={<StateBadge tone={live ? "ready" : "pending"}>{readOnly ? "Read only" : busyAction ? "Command active" : live ? "Ready" : "Unavailable"}</StateBadge>} />
        <div className="climate-operations-grid">
          <div className="climate-control-group">
            <ClimateSegmentedControl label="HVAC mode" options={climate?.hvacModes ?? []} value={climate?.hvacMode ?? null} disabled={controlsDisabled || !climate?.capabilities.setHvacMode} onSelect={(hvacMode) => onCommand({ action: "set_hvac_mode", hvacMode })} />
            <p>Switch heating, cooling, automatic range, or standby using modes advertised by this ecobee.</p>
          </div>
          <div className="climate-control-group">
            <ClimateSegmentedControl label="Fan mode" options={climate?.fanModes ?? []} value={climate?.fanMode ?? null} disabled={controlsDisabled || !climate?.capabilities.setFanMode} onSelect={(fanMode) => onCommand({ action: "set_fan_mode", fanMode })} />
            <p><strong>Fan On creates an indefinite thermostat hold.</strong> Timed fan holds are not exposed by this local ecobee connection; use Resume schedule when finished.</p>
          </div>
          <div className="climate-control-group">
            {climate?.scheduleModes.length ? <ClimateSegmentedControl label="Comfort mode" options={climate.scheduleModes} value={climate.scheduleMode} disabled={controlsDisabled || !climate.capabilities.setScheduleMode} onSelect={(scheduleMode) => onCommand({ action: "set_schedule_mode", scheduleMode })} /> : <ClimateSegmentedControl label="Preset" options={climate?.presetModes ?? []} value={climate?.presetMode ?? null} disabled={controlsDisabled || !climate?.capabilities.setPresetMode} onSelect={(presetMode) => onCommand({ action: "set_preset_mode", presetMode })} />}
            <button className="climate-resume-button" type="button" disabled={controlsDisabled || !climate?.capabilities.clearHold} onClick={() => onCommand({ action: "clear_hold" })}>Resume schedule / Clear hold</button>
            <p>Home, Sleep, and Away are temporary comfort holds. Resume returns control to the ecobee schedule.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function LightingView({ state, onToggle, onScene }: { state: DemoState; onToggle: (id: LightId) => void; onScene: (scene: DemoState["scene"]) => void }) {
  return <div className="dashboard-content"><DetailIntro code="LT" eyebrow="Lighting domain" title="Room and exterior lighting" description="Kasa switches, dimmers, scenes, and schedules will be organized here by space." badge="Kasa pending" /><Panel><PanelHeading eyebrow="Interactive preview" title="Lighting circuits" action={<StateBadge tone="sample">Demo controls</StateBadge>} /><div className="light-grid">{(Object.keys(state.lights) as LightId[]).map((id, index) => { const active = state.lights[id]; return <button className={`light-card ${active ? "light-card--active" : ""}`} type="button" key={id} onClick={() => onToggle(id)} aria-pressed={active}><span className="light-number">0{index + 1}</span><div className="bulb-glyph"><i /></div><div><strong>{lightLabels[id]}</strong><span>{active ? "On · 100%" : "Off"}</span></div><span className="toggle"><i /></span></button>; })}</div></Panel><Panel><PanelHeading eyebrow="Whole-home presets" title="Scenes" action={<StateBadge tone="sample">Interactive</StateBadge>} /><QuickScenes current={state.scene} onSelect={onScene} /></Panel></div>;
}

function MissionControlView() {
  const readouts = [
    { code: "H", label: "Human signatures", value: "01", detail: "Simulated" },
    { code: "A", label: "Animal signatures", value: "02", detail: "Simulated" },
    { code: "Z", label: "Illustrative zones", value: "04", detail: "Sample layout" },
    { code: "RF", label: "Live sensor links", value: "00", detail: "Not connected" },
  ];
  const plannedSources = [
    ["CSI", "Wi-Fi channel sensing", "Future experiment"],
    ["RAD", "Room radar presence", "Future integration"],
    ["CAM", "Protect classifications", "Future confirmation"],
    ["HA", "Home Assistant fusion", "No entities created"],
  ];

  return (
    <div className="dashboard-content">
      <DetailIntro
        code="MC"
        eyebrow="Mission control / RF perception"
        title="Invisible occupancy intelligence"
        description="A future view for privacy-minded room activity, human-or-animal confidence, and multi-sensor confirmation. Everything shown below is illustrative."
        badge="Demo mode only"
      />

      <div className="mission-layout">
        <Panel className="mission-map-panel">
          <PanelHeading eyebrow="Illustrative telemetry" title="Residence RF activity map" action={<StateBadge tone="sample">Synthetic feed</StateBadge>} />
          <div className="rf-map" role="img" aria-label="Demo floor plan showing one simulated human signature and two simulated animal signatures">
            <div className="rf-map__grid" aria-hidden="true" />
            <div className="rf-map__scan" aria-hidden="true" />
            <div className="rf-room rf-room--living"><span>Living / Kitchen</span></div>
            <div className="rf-room rf-room--entry"><span>Entry</span></div>
            <div className="rf-room rf-room--bedroom"><span>Primary</span></div>
            <div className="rf-room rf-room--office"><span>Office</span></div>

            <span className="rf-node rf-node--one"><i /><small>RX-01</small></span>
            <span className="rf-node rf-node--two"><i /><small>RX-02</small></span>
            <span className="rf-node rf-node--three"><i /><small>RX-03</small></span>

            <span className="rf-signature rf-signature--human"><i /><b>H-01</b><small>HUMAN / SIM</small></span>
            <span className="rf-signature rf-signature--animal-one"><i /><b>A-01</b><small>ANIMAL / SIM</small></span>
            <span className="rf-signature rf-signature--animal-two"><i /><b>A-02</b><small>ANIMAL / SIM</small></span>
            <span className="rf-map__watermark">SYNTHETIC FEED / NO LIVE RF INPUT</span>
          </div>
          <div className="rf-legend"><span><i className="rf-legend__human" />Human sample</span><span><i className="rf-legend__animal" />Animal sample</span><span><i className="rf-legend__node" />Planned receiver</span></div>
        </Panel>

        <Panel className="mission-readout-panel">
          <PanelHeading eyebrow="Sample readout" title="Perception summary" action={<StateBadge>Offline</StateBadge>} />
          <div className="mission-readouts">
            {readouts.map((item) => <div className="mission-readout" key={item.code}><span>{item.code}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{item.value}</b></div>)}
          </div>
          <div className="mission-demo-note"><StatusDot tone="amber" /><p><strong>Placeholder visualization</strong><span>These markers do not represent anyone currently inside the residence.</span></p></div>
        </Panel>
      </div>

      <div className="mission-lower-grid">
        <Panel>
          <PanelHeading eyebrow="Future architecture" title="Planned perception stack" action={<StateBadge>Not commissioned</StateBadge>} />
          <div className="mission-stack">{plannedSources.map(([code, name, status]) => <div key={code}><span>{code}</span><strong>{name}</strong><small>{status}</small><StateBadge>Pending</StateBadge></div>)}</div>
        </Panel>
        <Panel className="mission-guardrail">
          <div className="mission-guardrail__code">LOCK</div>
          <div><span className="section-kicker">Demo safety boundary</span><h3>Observation only. No actions.</h3><p>No sensing hardware, Home Assistant entities, alarm rules, locks, notifications, or dispatch workflows are connected to Mission Control.</p></div>
        </Panel>
      </div>
    </div>
  );
}

function NetworkView() {
  return <div className="dashboard-content"><DetailIntro code="NW" eyebrow="Network domain" title="UniFi infrastructure" description="Gateway, switching, wireless health, connected clients, and PoE status will appear here." badge="UniFi pending" /><div className="detail-grid detail-grid--network"><Panel className="network-map-panel"><PanelHeading eyebrow="Planned topology" title="Residence network" action={<StateBadge>Not connected</StateBadge>} /><div className="topology">{[["GW", "UniFi gateway", "Adoption pending"], ["CK", "Cloud Key Gen2", "Controller endpoint"], ["16", "16-port PoE switch", "Port data pending"], ["AP", "AC Lite", "Wireless data pending"]].map(([code, name, detail], index) => <div className="topology-node" key={name}><span>{code}</span><div><strong>{name}</strong><small>{detail}</small></div>{index < 3 && <i />}</div>)}</div></Panel><Panel><PanelHeading eyebrow="Preview telemetry" title="Network health" /><div className="network-metrics">{[["WAN status", "—"], ["Active clients", "—"], ["PoE draw", "—"], ["Wi-Fi experience", "—"]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>Awaiting data</small></div>)}</div><div className="device-note"><StatusDot tone="amber" /><p><strong>Local UniFi account required</strong><span>The Home Assistant connection will use a dedicated local controller user.</span></p></div></Panel></div></div>;
}

function CamerasView() {
  return <div className="dashboard-content"><DetailIntro code="CM" eyebrow="Camera domain" title="Property camera grid" description="Live views, events, and recording status will appear after compatible camera sources are added." /><Panel><PanelHeading eyebrow="Video matrix" title="Camera positions" action={<StateBadge>0 sources</StateBadge>} /><div className="camera-grid camera-grid--full"><EmptyCamera name="Front approach" /><EmptyCamera name="Rear perimeter" /><EmptyCamera name="Side entrance" /><EmptyCamera name="Interior overview" /></div></Panel></div>;
}

function UtilitiesView() {
  return <div className="dashboard-content"><DetailIntro code="UT" eyebrow="Utility domain" title="Infrastructure monitoring" description="A future home for water, hot water, leak protection, power, and environmental telemetry." badge="Future expansion" /><div className="utility-card-grid">{[["WP", "Water pressure", "PSI", "Track supply pressure and abnormal drops."], ["HW", "Hot water", "°F", "Monitor tank temperature and recovery."], ["LK", "Leak protection", "STATE", "Detect water and command a shutoff valve."], ["PW", "Energy", "kW", "Measure whole-home and circuit consumption."]].map(([code, name, unit, detail]) => <Panel className="utility-detail-card" key={code}><span className="utility-code">{code}</span><StateBadge>Sensor planned</StateBadge><strong>{name}</strong><div className="utility-placeholder">— <small>{unit}</small></div><p>{detail}</p></Panel>)}</div></div>;
}

function ConnectionsView({ connection, climate }: { connection: HomeAssistantConnection; climate: ClimateSnapshot | null }) {
  const homeAssistantReady = connection === "connected";
  const climateReady = homeAssistantReady && climate?.available === true;
  const systems = [
    { code: "DC", name: "Dover portal", badge: "Ready", ready: true, detail: "The interface shell, private preview access, responsive layout, and simulated controls are online.", foot: "Interface layer · Complete" },
    { code: "HA", name: "Home Assistant", badge: homeAssistantReady ? "Ready" : connection === "checking" ? "Connecting" : "Unavailable", ready: homeAssistantReady, detail: "Authenticated server bridge to the Home Assistant control core through Home Assistant Cloud.", foot: homeAssistantReady ? "Control core · Live" : "Control core · Check required" },
    { code: "UI", name: "UniFi", badge: "Queued", ready: false, detail: "Network health, client presence, gateway, switching, wireless, and supported controls.", foot: "Network integration · Next phase" },
    { code: "EC", name: "ecobee", badge: climateReady ? "Live" : "Pending", ready: climateReady, detail: "Live temperature, humidity, HVAC state, and thermostat target controls from the Living Room.", foot: climateReady ? "Climate integration · Live" : "Climate integration · Check required" },
    { code: "KS", name: "Kasa", badge: "Deferred", ready: false, detail: "The KP115 firmware currently blocks the local Home Assistant integration; no lighting command is enabled here.", foot: "Lighting integration · Firmware blocked" },
  ];
  const readyCount = systems.filter((system) => system.ready).length;
  return <div className="dashboard-content"><DetailIntro code="CN" eyebrow="Connection center" title="Systems and integrations" description="Live integrations are isolated behind an authenticated server bridge; uncommissioned systems remain visibly simulated or disabled." badge={`${readyCount} of ${systems.length} ready`} badgeTone={climateReady ? "ready" : "pending"} /><div className="connection-card-grid">{systems.map((system) => <Panel className={`connection-detail ${system.ready ? "connection-detail--ready" : ""}`} key={system.code}><div className="connection-detail__head"><div className={`connection-icon ${system.ready ? "connection-icon--ready" : ""}`}>{system.code}</div><StateBadge tone={system.ready ? "ready" : "pending"}>{system.badge}</StateBadge></div><h3>{system.name}</h3><p>{system.detail}</p><div className="progress-line"><i style={{ width: system.ready ? "100%" : "0%" }} /></div><small>{system.foot}</small></Panel>)}</div><Panel className="commission-panel"><div><span className="section-kicker">Next milestone</span><h3>{climateReady ? "Validate live climate control" : "Verify the Home Assistant bridge"}</h3><p>{climateReady ? "Send one small target-temperature change, confirm it at the ecobee, and then restore the original setting." : "Confirm the protected bridge credentials and exact climate entity before enabling a physical command."}</p></div><span className="commission-number">{climateReady ? "02" : "01"}</span></Panel></div>;
}

function AccountSettingsView({ email, role, busyAction, onOpenUsers, onPasswordReset, onSignOut }: { email: string | null; role: OperatorSession["role"]; busyAction: AccountAction | null; onOpenUsers: () => void; onPasswordReset: () => void; onSignOut: () => void }) {
  return (
    <div className="dashboard-content">
      <DetailIntro code="ID" eyebrow="Operator account" title="Identity and access" description="Review the authenticated account, update its password securely, or terminate the current session." badge="Session active" />
      <div className="detail-grid detail-grid--wide account-settings-grid">
        <Panel>
          <PanelHeading eyebrow="Current identity" title="Authenticated operator" action={<StateBadge tone="ready">Verified</StateBadge>} />
          <div className="account-detail-list">
            <div><span>Operator email</span><strong>{email ?? "Email unavailable"}</strong></div>
            <div><span>Authorization method</span><strong>Email and password</strong></div>
            <div><span>Access role</span><strong>{formatSystemState(role)}</strong></div>
            <div><span>Session status</span><strong className="account-session-status"><StatusDot tone="green" /> Active</strong></div>
          </div>
        </Panel>
        <Panel>
          <PanelHeading eyebrow="Security controls" title="Account actions" />
          <div className="account-security-list">
            <div className="account-security-item">
              <div><strong>Change password</strong><p>Receive a secure Firebase link at the authenticated email address.</p></div>
              <button className="account-secondary-button" type="button" onClick={onPasswordReset} disabled={busyAction !== null}>{busyAction === "reset" ? "Sending…" : "Email secure link"}</button>
            </div>
            <div className="account-security-item account-security-item--danger">
              <div><strong>Terminate session</strong><p>Sign out of Dover Controls on this device.</p></div>
              <button className="account-danger-button" type="button" onClick={onSignOut} disabled={busyAction !== null}>{busyAction === "logout" ? "Signing out…" : "Log out"}</button>
            </div>
          </div>
        </Panel>
      </div>
      {role === "owner" ? (
        <Panel className="account-administration-panel">
          <PanelHeading eyebrow="Owner controls" title="Access administration" action={<StateBadge tone="ready">Owner</StateBadge>} />
          <div className="account-administration-callout"><div><strong>Users & permissions</strong><p>Add or remove operators, assign access roles, disable accounts, and send secure password resets.</p></div><button className="account-secondary-button" type="button" onClick={onOpenUsers}>Manage users</button></div>
        </Panel>
      ) : null}
    </div>
  );
}

function AccountControl({ displayName, email, initials, role, busyAction, onOpenSettings, onOpenUsers, onPasswordReset, onSignOut }: { displayName: string; email: string | null; initials: string; role: OperatorSession["role"]; busyAction: AccountAction | null; onOpenSettings: () => void; onOpenUsers: () => void; onPasswordReset: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function select(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="account-control" ref={controlRef}>
      <button ref={triggerRef} className="account-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-label="Open operator account controls" aria-expanded={open} aria-controls="operator-account-panel">
        <span className="account-trigger__avatar">{initials}</span><span className="account-trigger__chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div id="operator-account-panel" className="account-popover" role="region" aria-label="Operator account controls">
          <div className="account-popover__identity"><span className="section-kicker">Operator control</span><strong>{displayName}</strong><small>{email ?? "Authenticated identity"}</small></div>
          <div className="account-popover__status"><StatusDot tone="green" /><span>{formatSystemState(role)} session active</span></div>
          <div className="account-popover__actions" aria-label="Account actions">
            <button type="button" onClick={() => select(onOpenSettings)}><span className="account-action__code">ST</span><span className="account-action__copy"><strong>Account settings</strong><small>Identity and access</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button>
            {role === "owner" ? <button type="button" onClick={() => select(onOpenUsers)}><span className="account-action__code">US</span><span className="account-action__copy"><strong>Users & permissions</strong><small>Owner administration</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button> : null}
            <button type="button" onClick={() => select(onPasswordReset)} disabled={busyAction !== null}><span className="account-action__code">PW</span><span className="account-action__copy"><strong>Change password</strong><small>Email a secure link</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button>
            <button className="account-popover__logout" type="button" onClick={() => select(onSignOut)} disabled={busyAction !== null}><span className="account-action__code">EX</span><span className="account-action__copy"><strong>Log out</strong><small>Terminate this session</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({ onExit, operator, user }: { onExit: () => void | Promise<void>; operator: OperatorSession; user: User }) {
  const [activeView, setActiveView] = useState<View>("overview");
  const [now, setNow] = useState(() => new Date(0));
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<number | null>(null);
  const [demoState, setDemoState] = useState<DemoState>(initialDemoState);
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null);
  const [homeAssistantConnection, setHomeAssistantConnection] = useState<HomeAssistantConnection>("checking");
  const [climate, setClimate] = useState<ClimateSnapshot | null>(null);
  const [climateBusyAction, setClimateBusyAction] = useState<ClimateBusyAction>(null);
  const { displayName, initials } = useMemo(() => {
    const identity = getOperatorIdentity(user);
    if (!operator.displayName) return identity;
    const nameParts = operator.displayName.split(/\s+/).filter(Boolean);
    const operatorInitials = nameParts.length > 1
      ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`
      : operator.displayName.slice(0, 2);
    return { displayName: operator.displayName, initials: operatorInitials.toUpperCase() };
  }, [operator.displayName, user]);

  useEffect(() => {
    let loadTimer: number | undefined;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const restored = { ...initialDemoState, ...JSON.parse(saved) };
        loadTimer = window.setTimeout(() => setDemoState(restored), 0);
      }
    } catch { /* optional */ }
    return () => { if (loadTimer) window.clearTimeout(loadTimer); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(demoState)); } catch { /* optional */ } }, [demoState]);

  const refreshClimate = useCallback(async () => {
    try {
      const snapshot = await climateRequest(user);
      setClimate(snapshot);
      setHomeAssistantConnection("connected");
      return snapshot;
    } catch {
      setHomeAssistantConnection("unavailable");
      return null;
    }
  }, [user]);

  useEffect(() => {
    if (climateBusyAction !== null) return;
    const initial = window.setTimeout(() => void refreshClimate(), 0);
    const timer = window.setInterval(() => void refreshClimate(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [climateBusyAction, refreshClimate]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const notify = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 4200);
  }, []);
  function applyState(next: DemoState, message: string) { setDemoState(next); notify(`${message} — no physical device was changed.`); }
  function selectScene(scene: DemoState["scene"]) {
    const configurations: Record<DemoState["scene"], Pick<DemoState, "lights" | "securityMode">> = {
      Home: { lights: { living: true, kitchen: true, bedroom: false, exterior: false }, securityMode: "Standby" },
      Away: { lights: { living: false, kitchen: false, bedroom: false, exterior: false }, securityMode: "Armed" },
      Night: { lights: { living: false, kitchen: false, bedroom: false, exterior: true }, securityMode: "Standby" },
      "All Off": { lights: { living: false, kitchen: false, bedroom: false, exterior: false }, securityMode: "Standby" },
    };
    applyState({ ...demoState, scene, ...configurations[scene] }, `${scene} scene preview updated`);
  }
  function toggleLight(id: LightId) { const lights = { ...demoState.lights, [id]: !demoState.lights[id] }; applyState({ ...demoState, lights }, `${lightLabels[id]} ${lights[id] ? "turned on" : "turned off"}`); }
  async function runClimateCommand(command: ClimateCommand) {
    if (!climate?.available || climateBusyAction !== null || operator.role === "viewer") {
      notify("Live climate control is unavailable. No command was sent.");
      return;
    }

    setClimateBusyAction(command.action);
    try {
      const result = await climateCommandRequest(user, command);
      setClimate(result);
      setHomeAssistantConnection("connected");
      if (result.command.status === "accepted") {
        notify(command.action === "clear_hold"
          ? "Resume request sent to Home Assistant. Live state will confirm the ecobee response."
          : "Comfort-mode request sent to Home Assistant. Live state will confirm the ecobee response.");
      } else if (command.action === "set_fan_mode") {
        notify(command.fanMode === "on"
          ? "Fan set to On. This indefinite hold remains until Resume schedule is used."
          : `Fan mode set to ${formatSystemState(command.fanMode)}.`);
      } else {
        switch (command.action) {
          case "set_temperature":
            notify("Thermostat target confirmed through Home Assistant.");
            break;
          case "set_hvac_mode":
            notify("HVAC mode confirmed through Home Assistant.");
            break;
          case "set_preset_mode":
            notify("Thermostat preset confirmed through Home Assistant.");
            break;
          case "set_schedule_mode":
            notify("Comfort mode confirmed through Home Assistant.");
            break;
          case "clear_hold":
            notify("The ecobee schedule has resumed.");
            break;
        }
      }
    } catch {
      notify("The thermostat did not accept or confirm that command. Live state is being refreshed.");
      void refreshClimate();
    } finally {
      setClimateBusyAction(null);
    }
  }
  function toggleSecurity() { const securityMode = demoState.securityMode === "Armed" ? "Standby" : "Armed"; applyState({ ...demoState, securityMode }, `Security preview set to ${securityMode}`); }
  async function requestPasswordReset() {
    if (!user.email) {
      notify("No email address is available for this authenticated account.");
      return;
    }

    setAccountAction("reset");
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), user.email);
      notify(`A secure password-change link was sent to ${user.email}.`);
    } catch (error) {
      notify(getAccountActionErrorMessage(error, "reset"));
    } finally {
      setAccountAction(null);
    }
  }
  async function terminateSession() {
    setAccountAction("logout");
    try {
      await onExit();
    } catch (error) {
      setAccountAction(null);
      notify(getAccountActionErrorMessage(error, "logout"));
    }
  }

  const clockReady = now.getTime() > 0;
  const formattedTime = useMemo(() => clockReady ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--:--", [clockReady, now]);
  const formattedDate = useMemo(() => clockReady ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : "Local time initializing", [clockReady, now]);
  const greeting = !clockReady ? "Welcome back" : now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";

  let content: ReactNode;
  switch (activeView) {
    case "mission": content = <MissionControlView />; break;
    case "security": content = <SecurityView state={demoState} onArm={toggleSecurity} />; break;
    case "climate": content = <ClimateView climate={climate} connection={homeAssistantConnection} busyAction={climateBusyAction} readOnly={operator.role === "viewer"} onCommand={(command) => void runClimateCommand(command)} />; break;
    case "lighting": content = <LightingView state={demoState} onToggle={toggleLight} onScene={selectScene} />; break;
    case "network": content = <NetworkView />; break;
    case "cameras": content = <CamerasView />; break;
    case "utilities": content = <UtilitiesView />; break;
    case "connections": content = <ConnectionsView connection={homeAssistantConnection} climate={climate} />; break;
    case "users": content = operator.role === "owner" ? <UserManagementView user={user} currentOperator={operator} bootstrapOwnerEmail="kkratoville@gmail.com" onNotice={notify} /> : <Overview state={demoState} climate={climate} connection={homeAssistantConnection} onScene={selectScene} onNavigate={setActiveView} />; break;
    case "settings": content = <AccountSettingsView email={user.email} role={operator.role} busyAction={accountAction} onOpenUsers={() => setActiveView("users")} onPasswordReset={() => void requestPasswordReset()} onSignOut={() => void terminateSession()} />; break;
    default: content = <Overview state={demoState} climate={climate} connection={homeAssistantConnection} onScene={selectScene} onNavigate={setActiveView} />;
  }
  const activeLabel = activeView === "settings" ? "Account settings" : activeView === "users" ? "Users & permissions" : navItems.find((item) => item.id === activeView)?.label ?? "Overview";

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark compact /></div>
        <nav className="desktop-nav" aria-label="Dashboard sections"><span className="nav-heading">Command domains</span>{navItems.map((item) => <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}><span>{item.code}</span>{item.label}{activeView === item.id && <i />}</button>)}</nav>
        <div className="sidebar-status"><span className="nav-heading">System status</span><div><StatusDot tone="green" /><p><strong>Portal ready</strong><small>Authenticated control UI</small></p></div><div><StatusDot tone={homeAssistantConnection === "connected" ? "green" : "amber"} /><p><strong>{homeAssistantConnection === "connected" ? "HA connected" : homeAssistantConnection === "checking" ? "HA connecting" : "HA unavailable"}</strong><small>{homeAssistantConnection === "connected" && climate?.available ? "ecobee climate live" : "Climate controls disabled"}</small></p></div></div>
        <button className="profile-card" type="button" onClick={() => setActiveView("settings")} aria-label={`Open account settings for ${user.email ?? displayName}`} title={user.email ?? "Signed-in account"}><span className="avatar">{initials}</span><span><strong>{displayName}</strong><small>{formatSystemState(operator.role)} access</small></span><i>›</i></button>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-header"><div><span className="breadcrumb">Dover residence / {activeLabel}</span><h1>{greeting}, {displayName}.</h1></div><div className="header-right"><div className="time-block"><strong>{formattedTime}</strong><span>{formattedDate}</span></div><AccountControl displayName={displayName} email={user.email} initials={initials} role={operator.role} busyAction={accountAction} onOpenSettings={() => setActiveView("settings")} onOpenUsers={() => setActiveView("users")} onPasswordReset={() => void requestPasswordReset()} onSignOut={() => void terminateSession()} /></div></header>
        {content}
      </section>
      <nav className="mobile-nav" aria-label="Mobile dashboard sections">{navItems.slice(0, 5).map((item) => <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}><span>{item.code}</span><small>{item.label}</small></button>)}</nav>
      {toast && <div className="toast" role="status"><StatusDot tone="cyan" /><span>{toast}</span></div>}
    </main>
  );
}

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<OperatorSession | null>(null);
  const [authorizationChecking, setAuthorizationChecking] = useState(false);
  const [authInitializationMessage, setAuthInitializationMessage] = useState("");

  useEffect(() => {
    let initializationTimer: number | undefined;
    try {
      return onAuthStateChanged(
        getFirebaseAuth(),
        (nextUser) => {
          setUser(nextUser);
          setAuthReady(true);
        },
        (error) => {
          setAuthInitializationMessage(getAuthErrorMessage(error));
          setAuthReady(true);
        },
      );
    } catch (error) {
      initializationTimer = window.setTimeout(() => {
        setAuthInitializationMessage(getAuthErrorMessage(error));
        setAuthReady(true);
      }, 0);
    }

    return () => {
      if (initializationTimer !== undefined) window.clearTimeout(initializationTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setOperator(null);
      setAuthorizationChecking(false);
      return;
    }

    setAuthorizationChecking(true);
    operatorSessionRequest(user)
      .then((session) => {
        if (cancelled) return;
        setOperator(session);
        setAuthorizationChecking(false);
      })
      .catch(async (error) => {
        if (cancelled) return;
        const status = error instanceof SessionAuthorizationError ? error.status : 503;
        setAuthInitializationMessage(status === 403
          ? "This identity is not authorized for Dover Controls. Contact the owner for access."
          : "Authorization could not be verified. Please sign in again.");
        setOperator(null);
        setAuthorizationChecking(false);
        try { await signOut(getFirebaseAuth()); } catch { /* local state still fails closed */ }
      });

    return () => { cancelled = true; };
  }, [user]);

  if (!authReady || (user && authorizationChecking)) return <AuthLoadingScreen />;
  if (!user) return <LoginScreen initialMessage={authInitializationMessage} />;
  if (!operator) return <AuthLoadingScreen />;

  return <Dashboard user={user} operator={operator} onExit={() => signOut(getFirebaseAuth())} />;
}
