"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
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
  | "security"
  | "climate"
  | "lighting"
  | "network"
  | "cameras"
  | "utilities"
  | "connections";

type LightId = "living" | "kitchen" | "bedroom" | "exterior";

type DemoState = {
  lights: Record<LightId, boolean>;
  targetTemperature: number;
  scene: "Home" | "Away" | "Night" | "All Off";
  securityMode: "Standby" | "Armed";
};

const STORAGE_KEY = "dover-controls-preview-v1";

const initialDemoState: DemoState = {
  lights: { living: true, kitchen: true, bedroom: false, exterior: false },
  targetTemperature: 70,
  scene: "Home",
  securityMode: "Standby",
};

const navItems: Array<{ id: View; code: string; label: string }> = [
  { id: "overview", code: "OV", label: "Overview" },
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
        <section className="login-intro" aria-labelledby="login-title">
          <div className="eyebrow"><span>DC-GATEWAY-01</span><span className="eyebrow-rule" /><span>Controlled systems access</span></div>
          <h1 id="login-title">One gateway.<br /><span>Controlled access.</span></h1>
          <p>A private command interface for protected systems, operational environments, and authorized control domains.</p>

          <div className="system-map" aria-label="Protected service topology">
            <div className="system-orbit system-orbit--outer" />
            <div className="system-orbit system-orbit--inner" />
            <div className="system-core"><span>DC</span><small>ACCESS CORE</small></div>
            <div className="orbit-node orbit-node--one"><span /> NODE 01</div>
            <div className="orbit-node orbit-node--two"><span /> NODE 02</div>
            <div className="orbit-node orbit-node--three"><span /> NODE 03</div>
          </div>
        </section>

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
      <footer className="login-footer"><span>Restricted interface · Authorized identities only</span><span>Identity verification / Restricted access</span></footer>
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

function Overview({ state, onScene, onNavigate }: { state: DemoState; onScene: (scene: DemoState["scene"]) => void; onNavigate: (view: View) => void }) {
  const lightsOn = Object.values(state.lights).filter(Boolean).length;
  return (
    <div className="dashboard-content">
      <div className="overview-grid">
        <Panel className="command-panel">
          <div className="command-copy"><span className="section-kicker">Residence status / Pre-commission</span><h2>Systems waiting for Home Assistant</h2><p>The Dover Controls interface is ready. Connect the home control core when your Raspberry Pi is online.</p><button className="link-button" type="button" onClick={() => onNavigate("connections")}>Review connection plan <span aria-hidden="true">→</span></button></div>
          <div className="command-core" aria-hidden="true"><div className="core-ring core-ring--outer" /><div className="core-ring core-ring--inner" /><div className="core-center"><span>DC</span><small>READY</small></div><i className="core-node core-node--one" /><i className="core-node core-node--two" /><i className="core-node core-node--three" /></div>
          <div className="command-footer"><span><StatusDot tone="green" /> Portal online</span><span><StatusDot tone="amber" /> HA link pending</span><span><StatusDot tone="amber" /> 3 integrations queued</span></div>
        </Panel>
        <Panel className="scenes-panel"><PanelHeading eyebrow="Preview controls" title="Quick scenes" action={<StateBadge tone="sample">Demo</StateBadge>} /><QuickScenes current={state.scene} onSelect={onScene} /></Panel>
      </div>

      <div className="metric-grid">
        <button className="metric-card" type="button" onClick={() => onNavigate("security")}><span className="metric-top"><span className="metric-code">SC</span><StateBadge>Awaiting</StateBadge></span><strong>Security</strong><span className="metric-value">Standby</span><small>Sensors not commissioned</small><i className="metric-line" /></button>
        <button className="metric-card" type="button" onClick={() => onNavigate("climate")}><span className="metric-top"><span className="metric-code">CL</span><StateBadge tone="sample">Preview data</StateBadge></span><strong>Climate</strong><span className="metric-value">72<span>°</span></span><small>Target {state.targetTemperature}° · Humidity 48%</small><i className="metric-line metric-line--cyan" /></button>
        <button className="metric-card" type="button" onClick={() => onNavigate("lighting")}><span className="metric-top"><span className="metric-code">LT</span><StateBadge tone="sample">Interactive</StateBadge></span><strong>Lighting</strong><span className="metric-value">{lightsOn}<span>/4</span></span><small>Demo circuits active</small><i className="metric-line metric-line--green" /></button>
        <button className="metric-card" type="button" onClick={() => onNavigate("network")}><span className="metric-top"><span className="metric-code">NW</span><StateBadge>Awaiting</StateBadge></span><strong>Network</strong><span className="metric-value metric-value--word">UniFi</span><small>Controller connection pending</small><i className="metric-line" /></button>
      </div>

      <div className="lower-grid">
        <Panel className="camera-panel"><PanelHeading eyebrow="Property view" title="Camera grid" action={<button className="text-button" type="button" onClick={() => onNavigate("cameras")}>All cameras →</button>} /><div className="camera-grid camera-grid--overview"><EmptyCamera name="Front approach" /><EmptyCamera name="Rear perimeter" /></div></Panel>
        <Panel className="connections-panel"><PanelHeading eyebrow="Control plane" title="Connection center" action={<button className="text-button" type="button" onClick={() => onNavigate("connections")}>Manage →</button>} /><div className="connection-list"><ConnectionRow code="DC" name="Dover portal" detail="Interface layer" ready /><ConnectionRow code="HA" name="Home Assistant" detail="Local control core" /><ConnectionRow code="03" name="Device integrations" detail="UniFi · ecobee · Kasa" /></div></Panel>
      </div>

      <div className="lower-grid lower-grid--utilities">
        <Panel><PanelHeading eyebrow="Future expansion" title="Home utilities" action={<StateBadge>Planned</StateBadge>} /><div className="utility-list">{[["WP", "Water pressure", "Sensor not installed"], ["HW", "Hot water", "Temperature monitor planned"], ["LK", "Leak protection", "Valve controller planned"], ["PW", "Power", "Energy monitoring planned"]].map(([code, name, detail]) => <div className="utility-item" key={code}><span>{code}</span><div><strong>{name}</strong><small>{detail}</small></div><i /></div>)}</div></Panel>
        <Panel><PanelHeading eyebrow="System log" title="Recent activity" /><div className="activity-list"><div><span className="activity-time">NOW</span><i className="activity-dot activity-dot--green" /><p><strong>Portal interface ready</strong><small>Dover Controls prototype initialized</small></p></div><div><span className="activity-time">NEXT</span><i className="activity-dot" /><p><strong>Commission Home Assistant</strong><small>Raspberry Pi setup is the next milestone</small></p></div><div><span className="activity-time">LATER</span><i className="activity-dot" /><p><strong>Connect residence systems</strong><small>Authorize UniFi, ecobee, and Kasa</small></p></div></div></Panel>
      </div>
    </div>
  );
}

function DetailIntro({ code, eyebrow, title, description, badge = "Awaiting connection" }: { code: string; eyebrow: string; title: string; description: string; badge?: string }) {
  return <Panel className="detail-intro"><div className="detail-code">{code}</div><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><StateBadge>{badge}</StateBadge></Panel>;
}

function SecurityView({ state, onArm }: { state: DemoState; onArm: () => void }) {
  return <div className="dashboard-content"><DetailIntro code="SC" eyebrow="Security domain" title="Property protection" description="One view for access, occupancy, perimeter monitoring, and future alarm controls." /><div className="detail-grid detail-grid--wide"><Panel><PanelHeading eyebrow="Preview mode" title="Security posture" action={<StateBadge tone="sample">Simulation</StateBadge>} /><div className="security-posture"><div className={`shield-visual ${state.securityMode === "Armed" ? "shield-visual--armed" : ""}`}><span>{state.securityMode === "Armed" ? "ARMED" : "STANDBY"}</span></div><div><span className="section-kicker">Current preview state</span><strong>{state.securityMode}</strong><p>No door, window, motion, or alarm entities have been commissioned.</p><button className="primary-button primary-button--compact" type="button" onClick={onArm}>{state.securityMode === "Armed" ? "Return to standby" : "Preview away arming"}</button></div></div></Panel><Panel><PanelHeading eyebrow="Planned zones" title="Sensor matrix" /><div className="zone-list">{[["Entry points", "Door and window contacts"], ["Interior", "Occupancy and motion"], ["Perimeter", "Exterior camera events"], ["Life safety", "Smoke, CO, and water"]].map(([name, detail], index) => <div className="zone-row" key={name}><span>0{index + 1}</span><div><strong>{name}</strong><small>{detail}</small></div><StateBadge>Planned</StateBadge></div>)}</div></Panel></div></div>;
}

function ClimateView({ state, onTemperature }: { state: DemoState; onTemperature: (value: number) => void }) {
  return <div className="dashboard-content"><DetailIntro code="CL" eyebrow="Climate domain" title="Whole-home comfort" description="Thermostat, room sensors, schedules, humidity, and HVAC status will live here." badge="ecobee pending" /><div className="detail-grid detail-grid--wide"><Panel className="thermostat-panel"><PanelHeading eyebrow="Thermostat preview" title="Main floor" action={<StateBadge tone="sample">Sample data</StateBadge>} /><div className="thermostat"><div className="temperature-ring"><div><small>Indoor</small><strong>72<span>°</span></strong><em>48% humidity</em></div></div><div className="temperature-controls"><span className="section-kicker">Comfort target</span><div><button type="button" aria-label="Lower target temperature" onClick={() => onTemperature(state.targetTemperature - 1)}>−</button><strong>{state.targetTemperature}°</strong><button type="button" aria-label="Raise target temperature" onClick={() => onTemperature(state.targetTemperature + 1)}>+</button></div><p>HVAC mode <strong>Idle</strong></p><small>Updates affect this preview only.</small></div></div></Panel><Panel><PanelHeading eyebrow="Room sensors" title="Comfort zones" /><div className="room-list">{[["Main floor", "72°", "48%"], ["Primary bedroom", "—", "—"], ["Lower level", "—", "—"]].map(([name, temp, humidity], index) => <div className="room-row" key={name}><span>0{index + 1}</span><strong>{name}</strong><div><b>{temp}</b><small>{humidity} RH</small></div></div>)}</div><div className="device-note"><StatusDot tone="amber" /><p><strong>ecobee awaiting connection</strong><span>Live temperature and HVAC controls will replace sample values.</span></p></div></Panel></div></div>;
}

function LightingView({ state, onToggle, onScene }: { state: DemoState; onToggle: (id: LightId) => void; onScene: (scene: DemoState["scene"]) => void }) {
  return <div className="dashboard-content"><DetailIntro code="LT" eyebrow="Lighting domain" title="Room and exterior lighting" description="Kasa switches, dimmers, scenes, and schedules will be organized here by space." badge="Kasa pending" /><Panel><PanelHeading eyebrow="Interactive preview" title="Lighting circuits" action={<StateBadge tone="sample">Demo controls</StateBadge>} /><div className="light-grid">{(Object.keys(state.lights) as LightId[]).map((id, index) => { const active = state.lights[id]; return <button className={`light-card ${active ? "light-card--active" : ""}`} type="button" key={id} onClick={() => onToggle(id)} aria-pressed={active}><span className="light-number">0{index + 1}</span><div className="bulb-glyph"><i /></div><div><strong>{lightLabels[id]}</strong><span>{active ? "On · 100%" : "Off"}</span></div><span className="toggle"><i /></span></button>; })}</div></Panel><Panel><PanelHeading eyebrow="Whole-home presets" title="Scenes" action={<StateBadge tone="sample">Interactive</StateBadge>} /><QuickScenes current={state.scene} onSelect={onScene} /></Panel></div>;
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

function ConnectionsView() {
  const systems = [
    { code: "DC", name: "Dover portal", badge: "Ready", ready: true, detail: "The interface shell, private preview access, responsive layout, and simulated controls are online.", foot: "Interface layer · Complete" },
    { code: "HA", name: "Home Assistant", badge: "Not connected", detail: "The Raspberry Pi will become the local control and automation core for this dashboard.", foot: "Local core · Awaiting hardware" },
    { code: "UI", name: "UniFi", badge: "Awaiting HA", detail: "Network health, client presence, gateway, switching, wireless, and supported controls.", foot: "Network integration · Queued" },
    { code: "EC", name: "ecobee", badge: "Awaiting HA", detail: "Temperatures, humidity, HVAC mode, comfort settings, and thermostat controls.", foot: "Climate integration · Queued" },
    { code: "KS", name: "Kasa", badge: "Awaiting HA", detail: "Local switching, lighting states, dimming, and energy data on supported devices.", foot: "Lighting integration · Queued" },
  ];
  return <div className="dashboard-content"><DetailIntro code="CN" eyebrow="Connection center" title="Systems and integrations" description="This is the commissioning plan for the local Home Assistant core and every connected platform." badge="1 of 5 ready" /><div className="connection-card-grid">{systems.map((system) => <Panel className={`connection-detail ${system.ready ? "connection-detail--ready" : ""}`} key={system.code}><div className="connection-detail__head"><div className={`connection-icon ${system.ready ? "connection-icon--ready" : ""}`}>{system.code}</div><StateBadge tone={system.ready ? "ready" : "pending"}>{system.badge}</StateBadge></div><h3>{system.name}</h3><p>{system.detail}</p><div className="progress-line"><i style={{ width: system.ready ? "100%" : "0%" }} /></div><small>{system.foot}</small></Panel>)}</div><Panel className="commission-panel"><div><span className="section-kicker">Next milestone</span><h3>Commission the local control core</h3><p>Once Home Assistant OS is running, we can replace the mock provider with live entities while keeping this interface intact.</p></div><span className="commission-number">01</span></Panel></div>;
}

function Dashboard({ onExit, userEmail }: { onExit: () => void | Promise<void>; userEmail: string | null }) {
  const [activeView, setActiveView] = useState<View>("overview");
  const [now, setNow] = useState(() => new Date(0));
  const [toast, setToast] = useState("");
  const [demoState, setDemoState] = useState<DemoState>(initialDemoState);

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
  function setTemperature(value: number) { const bounded = Math.min(80, Math.max(60, value)); applyState({ ...demoState, targetTemperature: bounded }, `Climate target set to ${bounded}°`); }
  function toggleSecurity() { const securityMode = demoState.securityMode === "Armed" ? "Standby" : "Armed"; applyState({ ...demoState, securityMode }, `Security preview set to ${securityMode}`); }

  const clockReady = now.getTime() > 0;
  const formattedTime = useMemo(() => clockReady ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--:--", [clockReady, now]);
  const formattedDate = useMemo(() => clockReady ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : "Local time initializing", [clockReady, now]);
  const greeting = !clockReady ? "Welcome back" : now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";

  let content: ReactNode;
  switch (activeView) {
    case "security": content = <SecurityView state={demoState} onArm={toggleSecurity} />; break;
    case "climate": content = <ClimateView state={demoState} onTemperature={setTemperature} />; break;
    case "lighting": content = <LightingView state={demoState} onToggle={toggleLight} onScene={selectScene} />; break;
    case "network": content = <NetworkView />; break;
    case "cameras": content = <CamerasView />; break;
    case "utilities": content = <UtilitiesView />; break;
    case "connections": content = <ConnectionsView />; break;
    default: content = <Overview state={demoState} onScene={selectScene} onNavigate={setActiveView} />;
  }
  const activeLabel = navItems.find((item) => item.id === activeView)?.label ?? "Overview";

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark compact /></div>
        <nav className="desktop-nav" aria-label="Dashboard sections"><span className="nav-heading">Command domains</span>{navItems.map((item) => <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}><span>{item.code}</span>{item.label}{activeView === item.id && <i />}</button>)}</nav>
        <div className="sidebar-status"><span className="nav-heading">System status</span><div><StatusDot tone="green" /><p><strong>Portal ready</strong><small>Simulation mode</small></p></div><div><StatusDot tone="amber" /><p><strong>HA disconnected</strong><small>Awaiting local core</small></p></div></div>
        <button className="profile-card" type="button" onClick={() => void onExit()} aria-label={userEmail ? `Sign out ${userEmail}` : "Sign out"} title={userEmail ?? "Signed-in account"}><span className="avatar">KK</span><span><strong>Kyle</strong><small>Sign out</small></span><i>↗</i></button>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-header"><div><span className="breadcrumb">Dover residence / {activeLabel}</span><h1>{greeting}, Kyle.</h1></div><div className="header-right"><div className="time-block"><strong>{formattedTime}</strong><span>{formattedDate}</span></div><button className="alert-button" type="button" aria-label="No active alerts"><i /><span>0</span></button></div></header>
        <div className="simulation-banner" role="status"><div><StatusDot tone="amber" /><strong>Simulation mode</strong><span>Home Assistant is not connected. Controls update this preview only.</span></div><StateBadge tone="sample">No active alerts</StateBadge></div>
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

  return <Dashboard userEmail={user.email} onExit={() => signOut(getFirebaseAuth())} />;
}
