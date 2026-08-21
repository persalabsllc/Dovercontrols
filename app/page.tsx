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
import { getFirebaseAuth } from "@/lib/firebase";

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
  | "settings";

type LightId = "living" | "kitchen" | "bedroom" | "exterior";

type DemoState = {
  lights: Record<LightId, boolean>;
  scene: "Home" | "Away" | "Night" | "All Off";
  securityMode: "Standby" | "Armed";
};

type HomeAssistantConnection = "checking" | "connected" | "unavailable";

type ClimateSnapshot = {
  available: boolean;
  name: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  humidity: number | null;
  hvacMode: string;
  hvacAction: string | null;
  fanMode: string | null;
  presetMode: string | null;
  temperatureUnit: string;
  minTemperature: number;
  maxTemperature: number;
  updatedAt: string | null;
};

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

function isClimateSnapshot(value: unknown): value is ClimateSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClimateSnapshot>;
  return (
    typeof candidate.available === "boolean" &&
    typeof candidate.name === "string" &&
    isNullableNumber(candidate.currentTemperature) &&
    isNullableNumber(candidate.targetTemperature) &&
    isNullableNumber(candidate.humidity) &&
    typeof candidate.hvacMode === "string" &&
    isNullableString(candidate.hvacAction) &&
    isNullableString(candidate.fanMode) &&
    isNullableString(candidate.presetMode) &&
    typeof candidate.temperatureUnit === "string" &&
    typeof candidate.minTemperature === "number" &&
    typeof candidate.maxTemperature === "number" &&
    isNullableString(candidate.updatedAt)
  );
}

async function climateRequest(
  user: User,
  init: RequestInit = {},
): Promise<ClimateSnapshot> {
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

  const payload = (await response.json()) as unknown;
  if (!isClimateSnapshot(payload)) throw new Error("Home Assistant bridge returned invalid data");
  return payload;
}

function roundedTemperature(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
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
  const currentTemperature = roundedTemperature(climateLive ? climate.currentTemperature : null);
  const targetTemperature = roundedTemperature(climateLive ? climate.targetTemperature : null);
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
        <button className="metric-card" type="button" onClick={() => onNavigate("climate")}><span className="metric-top"><span className="metric-code">CL</span><StateBadge tone={climateLive ? "ready" : "pending"}>{climateLive ? "Live" : connection === "checking" ? "Connecting" : "Unavailable"}</StateBadge></span><strong>Climate</strong><span className="metric-value">{currentTemperature}<span>°</span></span><small>Target {targetTemperature}° · Humidity {humidity}</small><i className="metric-line metric-line--cyan" /></button>
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

function ClimateView({ climate, connection, busy, onTemperature }: { climate: ClimateSnapshot | null; connection: HomeAssistantConnection; busy: boolean; onTemperature: (value: number) => void }) {
  const live = connection === "connected" && climate?.available === true;
  const target = live ? climate.targetTemperature : null;
  const current = live ? climate.currentTemperature : null;
  const humidity = live ? climate.humidity : null;
  const controlsDisabled = !live || target === null || busy;
  const mode = live ? formatSystemState(climate.hvacMode) : "Unavailable";
  const action = live ? formatSystemState(climate.hvacAction) : "No live state";

  return (
    <div className="dashboard-content">
      <DetailIntro code="CL" eyebrow="Climate domain" title="Whole-home comfort" description="Live ecobee temperature, humidity, operating state, and target control through Home Assistant." badge={live ? "ecobee live" : connection === "checking" ? "Connecting" : "Bridge unavailable"} badgeTone={live ? "ready" : "pending"} />
      <div className="detail-grid detail-grid--wide">
        <Panel className="thermostat-panel">
          <PanelHeading eyebrow="Home Assistant climate" title={climate?.name ?? "Dover House"} action={<StateBadge tone={live ? "ready" : "pending"}>{live ? "Live data" : "Unavailable"}</StateBadge>} />
          <div className="thermostat">
            <div className="temperature-ring"><div><small>Indoor</small><strong>{roundedTemperature(current)}<span>°</span></strong><em>{humidity === null ? "— humidity" : `${Math.round(humidity)}% humidity`}</em></div></div>
            <div className="temperature-controls">
              <span className="section-kicker">Comfort target</span>
              <div><button type="button" aria-label="Lower target temperature" disabled={controlsDisabled} onClick={() => { if (target !== null) onTemperature(Math.round(target) - 1); }}>−</button><strong>{roundedTemperature(target)}°</strong><button type="button" aria-label="Raise target temperature" disabled={controlsDisabled} onClick={() => { if (target !== null) onTemperature(Math.round(target) + 1); }}>+</button></div>
              <p>HVAC mode <strong>{mode}</strong></p>
              <small>{busy ? "Sending command…" : live ? `Current action: ${action}` : "No command was sent."}</small>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeading eyebrow="Room sensors" title="Comfort zones" />
          <div className="room-list">{[["Living room", `${roundedTemperature(current)}°`, humidity === null ? "—" : `${Math.round(humidity)}%`], ["Primary bedroom", "—", "—"], ["Lower level", "—", "—"]].map(([name, temp, roomHumidity], index) => <div className="room-row" key={name}><span>0{index + 1}</span><strong>{name}</strong><div><b>{temp}</b><small>{roomHumidity} RH</small></div></div>)}</div>
          <div className="device-note"><StatusDot tone={live ? "green" : "amber"} /><p><strong>{live ? "ecobee connected locally" : "ecobee link unavailable"}</strong><span>{live ? "State is refreshed every 15 seconds through the protected server bridge." : "Controls are disabled until a verified live state returns."}</span></p></div>
        </Panel>
      </div>
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

function AccountSettingsView({ email, busyAction, onPasswordReset, onSignOut }: { email: string | null; busyAction: AccountAction | null; onPasswordReset: () => void; onSignOut: () => void }) {
  return (
    <div className="dashboard-content">
      <DetailIntro code="ID" eyebrow="Operator account" title="Identity and access" description="Review the authenticated account, update its password securely, or terminate the current session." badge="Session active" />
      <div className="detail-grid detail-grid--wide account-settings-grid">
        <Panel>
          <PanelHeading eyebrow="Current identity" title="Authenticated operator" action={<StateBadge tone="ready">Verified</StateBadge>} />
          <div className="account-detail-list">
            <div><span>Operator email</span><strong>{email ?? "Email unavailable"}</strong></div>
            <div><span>Authorization method</span><strong>Email and password</strong></div>
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
    </div>
  );
}

function AccountControl({ displayName, email, initials, busyAction, onOpenSettings, onPasswordReset, onSignOut }: { displayName: string; email: string | null; initials: string; busyAction: AccountAction | null; onOpenSettings: () => void; onPasswordReset: () => void; onSignOut: () => void }) {
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
          <div className="account-popover__status"><StatusDot tone="green" /><span>Secure session active</span></div>
          <div className="account-popover__actions" aria-label="Account actions">
            <button type="button" onClick={() => select(onOpenSettings)}><span className="account-action__code">ST</span><span className="account-action__copy"><strong>Account settings</strong><small>Identity and access</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button>
            <button type="button" onClick={() => select(onPasswordReset)} disabled={busyAction !== null}><span className="account-action__code">PW</span><span className="account-action__copy"><strong>Change password</strong><small>Email a secure link</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button>
            <button className="account-popover__logout" type="button" onClick={() => select(onSignOut)} disabled={busyAction !== null}><span className="account-action__code">EX</span><span className="account-action__copy"><strong>Log out</strong><small>Terminate this session</small></span><span className="account-action__arrow" aria-hidden="true">→</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({ onExit, user }: { onExit: () => void | Promise<void>; user: User }) {
  const [activeView, setActiveView] = useState<View>("overview");
  const [now, setNow] = useState(() => new Date(0));
  const [toast, setToast] = useState("");
  const [demoState, setDemoState] = useState<DemoState>(initialDemoState);
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null);
  const [homeAssistantConnection, setHomeAssistantConnection] = useState<HomeAssistantConnection>("checking");
  const [climate, setClimate] = useState<ClimateSnapshot | null>(null);
  const [climateBusy, setClimateBusy] = useState(false);
  const { displayName, initials } = useMemo(() => getOperatorIdentity(user), [user]);

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
    const initial = window.setTimeout(() => void refreshClimate(), 0);
    const timer = window.setInterval(() => void refreshClimate(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshClimate]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
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
  async function setTemperature(value: number) {
    if (!climate?.available || climate.targetTemperature === null || climateBusy) {
      notify("Live climate control is unavailable. No command was sent.");
      return;
    }

    const lowerBound = Math.max(60, climate.minTemperature);
    const upperBound = Math.min(80, climate.maxTemperature);
    const bounded = Math.min(upperBound, Math.max(lowerBound, Math.round(value)));
    const previous = climate;
    setClimateBusy(true);
    setClimate({ ...climate, targetTemperature: bounded });

    try {
      const snapshot = await climateRequest(user, {
        method: "PATCH",
        body: JSON.stringify({ temperature: bounded }),
      });
      setClimate(snapshot);
      setHomeAssistantConnection("connected");
      notify(`Climate target set to ${bounded}° through Home Assistant.`);
    } catch {
      setClimate(previous);
      notify("The thermostat did not confirm the change. The previous target was restored on screen.");
      void refreshClimate();
    } finally {
      setClimateBusy(false);
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
    case "climate": content = <ClimateView climate={climate} connection={homeAssistantConnection} busy={climateBusy} onTemperature={(value) => void setTemperature(value)} />; break;
    case "lighting": content = <LightingView state={demoState} onToggle={toggleLight} onScene={selectScene} />; break;
    case "network": content = <NetworkView />; break;
    case "cameras": content = <CamerasView />; break;
    case "utilities": content = <UtilitiesView />; break;
    case "connections": content = <ConnectionsView connection={homeAssistantConnection} climate={climate} />; break;
    case "settings": content = <AccountSettingsView email={user.email} busyAction={accountAction} onPasswordReset={() => void requestPasswordReset()} onSignOut={() => void terminateSession()} />; break;
    default: content = <Overview state={demoState} climate={climate} connection={homeAssistantConnection} onScene={selectScene} onNavigate={setActiveView} />;
  }
  const activeLabel = activeView === "settings" ? "Account settings" : navItems.find((item) => item.id === activeView)?.label ?? "Overview";

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark compact /></div>
        <nav className="desktop-nav" aria-label="Dashboard sections"><span className="nav-heading">Command domains</span>{navItems.map((item) => <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}><span>{item.code}</span>{item.label}{activeView === item.id && <i />}</button>)}</nav>
        <div className="sidebar-status"><span className="nav-heading">System status</span><div><StatusDot tone="green" /><p><strong>Portal ready</strong><small>Authenticated control UI</small></p></div><div><StatusDot tone={homeAssistantConnection === "connected" ? "green" : "amber"} /><p><strong>{homeAssistantConnection === "connected" ? "HA connected" : homeAssistantConnection === "checking" ? "HA connecting" : "HA unavailable"}</strong><small>{homeAssistantConnection === "connected" && climate?.available ? "ecobee climate live" : "Climate controls disabled"}</small></p></div></div>
        <button className="profile-card" type="button" onClick={() => setActiveView("settings")} aria-label={`Open account settings for ${user.email ?? displayName}`} title={user.email ?? "Signed-in account"}><span className="avatar">{initials}</span><span><strong>{displayName}</strong><small>Account settings</small></span><i>›</i></button>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-header"><div><span className="breadcrumb">Dover residence / {activeLabel}</span><h1>{greeting}, {displayName}.</h1></div><div className="header-right"><div className="time-block"><strong>{formattedTime}</strong><span>{formattedDate}</span></div><AccountControl displayName={displayName} email={user.email} initials={initials} busyAction={accountAction} onOpenSettings={() => setActiveView("settings")} onPasswordReset={() => void requestPasswordReset()} onSignOut={() => void terminateSession()} /></div></header>
        <div className="simulation-banner" role="status"><div><StatusDot tone={homeAssistantConnection === "connected" ? "green" : "amber"} /><strong>{homeAssistantConnection === "connected" ? "Partial live mode" : homeAssistantConnection === "checking" ? "Connecting securely" : "Bridge unavailable"}</strong><span>{homeAssistantConnection === "connected" ? "The ecobee is live. Security, lighting, scenes, and cameras remain simulation-only." : "Physical climate controls remain disabled until Home Assistant responds."}</span></div><StateBadge tone={homeAssistantConnection === "connected" && climate?.available ? "ready" : "pending"}>{homeAssistantConnection === "connected" && climate?.available ? "Climate online" : "No physical commands"}</StateBadge></div>
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

  if (!authReady) return <AuthLoadingScreen />;
  if (!user) return <LoginScreen initialMessage={authInitializationMessage} />;

  return <Dashboard user={user} onExit={() => signOut(getFirebaseAuth())} />;
}
