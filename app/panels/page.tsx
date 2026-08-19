"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./panels.module.css";

type PanelId = "front" | "bedroom" | "outbuilding";
type AreaId = "house" | "outbuilding";
type TargetId = AreaId | "all";
type AlarmMode = "disarmed" | "arming-away" | "arming-home" | "arming-night" | "armed-away" | "armed-home" | "armed-night" | "triggered";
type AlarmAction = "away" | "home" | "night";
type PanicKind = "audible" | "silent";

type PanelConfig = {
  label: string;
  shortLabel: string;
  location: string;
  defaultTarget: TargetId;
  temperatureLabel: string;
  lights: Array<{ id: string; label: string; detail: string }>;
};

type PreviewState = {
  alarms: Record<AreaId, AlarmMode>;
  lights: Record<string, boolean>;
  targetTemperature: number;
  panic: PanicKind | null;
};

const STORAGE_KEY = "dover-controls-panel-preview-v1";

const panelConfigs: Record<PanelId, PanelConfig> = {
  front: {
    label: "Front Entry",
    shortLabel: "Entry",
    location: "Dover Residence / Main Entry",
    defaultTarget: "house",
    temperatureLabel: "Main floor",
    lights: [
      { id: "porch", label: "Porch", detail: "Exterior" },
      { id: "entry", label: "Entry", detail: "Foyer" },
      { id: "living", label: "Living", detail: "Main room" },
      { id: "exterior", label: "Exterior", detail: "All outside" },
    ],
  },
  bedroom: {
    label: "Primary Suite",
    shortLabel: "Bedroom",
    location: "Dover Residence / Primary Suite",
    defaultTarget: "house",
    temperatureLabel: "Primary suite",
    lights: [
      { id: "bedroom", label: "Bedroom", detail: "Ceiling" },
      { id: "bedside", label: "Bedside", detail: "Lamps" },
      { id: "hall", label: "Hallway", detail: "Night path" },
      { id: "exterior", label: "Exterior", detail: "Perimeter" },
    ],
  },
  outbuilding: {
    label: "Outbuilding",
    shortLabel: "Building",
    location: "Dover Property / Mission Building",
    defaultTarget: "outbuilding",
    temperatureLabel: "Outbuilding",
    lights: [
      { id: "building-interior", label: "Interior", detail: "Main lights" },
      { id: "building-exterior", label: "Exterior", detail: "Wall lights" },
      { id: "workbench", label: "Workbench", detail: "Task lights" },
      { id: "television", label: "Television", detail: "Power status" },
    ],
  },
};

const initialState: PreviewState = {
  alarms: { house: "disarmed", outbuilding: "armed-away" },
  lights: {
    porch: true,
    entry: true,
    living: false,
    exterior: true,
    bedroom: true,
    bedside: false,
    hall: false,
    "building-interior": false,
    "building-exterior": true,
    workbench: false,
    television: false,
  },
  targetTemperature: 70,
  panic: null,
};

const targets: Array<{ id: TargetId; label: string }> = [
  { id: "house", label: "House" },
  { id: "outbuilding", label: "Outbuilding" },
  { id: "all", label: "Entire property" },
];

function formatAlarmMode(mode: AlarmMode) {
  switch (mode) {
    case "armed-away": return "Armed away";
    case "armed-home": return "Armed home";
    case "armed-night": return "Sleep mode";
    case "arming-away": return "Arming away";
    case "arming-home": return "Arming home";
    case "arming-night": return "Arming sleep";
    case "triggered": return "Alarm active";
    default: return "Disarmed";
  }
}

function targetLabel(target: TargetId) {
  return targets.find((item) => item.id === target)?.label ?? "Selected area";
}

function Brand() {
  return (
    <div className={styles.brand}>
      <div className={styles.brandMark} aria-hidden="true"><span>DC</span><i /></div>
      <div><strong>Dover Controls</strong><span>Mission control panel</span></div>
    </div>
  );
}

function StatusDot({ tone }: { tone: "green" | "cyan" | "amber" | "red" }) {
  return <span className={`${styles.statusDot} ${styles[`statusDot_${tone}`]}`} aria-hidden="true" />;
}

function HoldAction({
  kind,
  onComplete,
}: {
  kind: PanicKind;
  onComplete: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);

  function beginHold() {
    if (timerRef.current) return;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onComplete();
    }, 1600);
  }

  function cancelHold() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
      event.preventDefault();
      beginHold();
    }
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") cancelHold();
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const audible = kind === "audible";
  return (
    <button
      className={`${styles.actionButton} ${audible ? styles.actionButtonDanger : styles.actionButtonSilent} ${holding ? styles.holding : ""}`}
      type="button"
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        beginHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      aria-label={`Press and hold to prepare ${audible ? "audible panic" : "silent panic"}`}
    >
      <span className={styles.actionCode}>{audible ? "!!" : "Ø!"}</span>
      <span className={styles.actionCopy}>
        <strong>{audible ? "Panic" : "Silent panic"}</strong>
        <small>{holding ? "Keep holding…" : "Hold to prepare"}</small>
      </span>
      <i className={styles.holdProgress} aria-hidden="true" />
    </button>
  );
}

function PinModal({ target, onCancel, onConfirm }: { target: TargetId; onCancel: () => void; onConfirm: () => void }) {
  const [pin, setPin] = useState("");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

  function press(key: string) {
    if (key === "clear") setPin("");
    else if (key === "back") setPin((value) => value.slice(0, -1));
    else setPin((value) => value.length < 6 ? `${value}${key}` : value);
  }

  return (
    <div className={styles.modalBackdrop} role="presentation" onPointerDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section className={styles.pinModal} role="dialog" aria-modal="true" aria-labelledby="pin-title">
        <div className={styles.modalHeader}>
          <div><span>Secure action</span><h2 id="pin-title">Disarm {targetLabel(target)}</h2></div>
          <button type="button" onClick={onCancel} aria-label="Close PIN keypad">×</button>
        </div>
        <div className={styles.pinDisplay} aria-label={`${pin.length} PIN digits entered`}>
          {Array.from({ length: 6 }, (_, index) => <i key={index} className={index < pin.length ? styles.pinFilled : ""} />)}
        </div>
        <div className={styles.pinGrid}>
          {keys.map((key) => (
            <button type="button" key={key} onClick={() => press(key)} aria-label={key === "back" ? "Delete last digit" : key === "clear" ? "Clear PIN" : `Digit ${key}`}>
              {key === "clear" ? "CLR" : key === "back" ? "⌫" : key}
            </button>
          ))}
        </div>
        <button className={styles.confirmButton} type="button" disabled={pin.length < 4} onClick={onConfirm}>Confirm disarm</button>
        <p>Simulation accepts any 4–6 digits. Nothing is stored. Live disarm will be verified by Alarmo.</p>
      </section>
    </div>
  );
}

function PanicModal({ kind, target, onCancel, onConfirm }: { kind: PanicKind; target: TargetId; onCancel: () => void; onConfirm: () => void }) {
  const audible = kind === "audible";
  return (
    <div className={styles.modalBackdrop} role="presentation" onPointerDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section className={`${styles.confirmModal} ${audible ? styles.confirmModalDanger : styles.confirmModalSilent}`} role="alertdialog" aria-modal="true" aria-labelledby="panic-title">
        <span className={styles.confirmIcon}>{audible ? "!!" : "Ø!"}</span>
        <span className={styles.modalKicker}>Second confirmation required</span>
        <h2 id="panic-title">{audible ? "Sound property alarm?" : "Send silent alert?"}</h2>
        <p>{audible ? `This preview will place ${targetLabel(target)} into an alarm state and mark all sirens active.` : "This preview will create an alert without sounding any siren. It does not contact emergency services."}</p>
        <div className={styles.confirmActions}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>{audible ? "Confirm audible panic" : "Confirm silent alert"}</button>
        </div>
      </section>
    </div>
  );
}

export default function PanelsPreview() {
  const [panelId, setPanelId] = useState<PanelId>("front");
  const [target, setTarget] = useState<TargetId>(panelConfigs.front.defaultTarget);
  const [state, setState] = useState<PreviewState>(initialState);
  const [now, setNow] = useState(() => new Date(0));
  const [toast, setToast] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [panicModal, setPanicModal] = useState<PanicKind | null>(null);
  const armingTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = panelConfigs[panelId];

  useEffect(() => {
    const activeArmingTimers = armingTimers.current;
    const clock = setInterval(() => setNow(new Date()), 1000);
    let restoredTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) restoredTimer = setTimeout(() => setState({ ...initialState, ...JSON.parse(saved) }), 0);
    } catch { /* local persistence is optional */ }
    return () => {
      clearInterval(clock);
      if (restoredTimer) clearTimeout(restoredTimer);
      activeArmingTimers.forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* optional */ }
  }, [state]);

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }

  function selectPanel(nextPanel: PanelId) {
    setPanelId(nextPanel);
    setTarget(panelConfigs[nextPanel].defaultTarget);
    notify(`${panelConfigs[nextPanel].label} layout loaded`);
  }

  function selectedAreas(): AreaId[] {
    return target === "all" ? ["house", "outbuilding"] : [target];
  }

  function cancelArmingTimers() {
    armingTimers.current.forEach(clearTimeout);
    armingTimers.current = [];
  }

  function arm(action: AlarmAction) {
    cancelArmingTimers();
    const armingMode = `arming-${action}` as AlarmMode;
    const armedMode = `armed-${action}` as AlarmMode;
    const areas = selectedAreas();
    setState((current) => ({
      ...current,
      panic: null,
      alarms: { ...current.alarms, ...Object.fromEntries(areas.map((area) => [area, armingMode])) },
    }));
    notify(`${targetLabel(target)} exit delay started — simulation only`);
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, alarms: { ...current.alarms, ...Object.fromEntries(areas.map((area) => [area, armedMode])) } }));
      notify(`${targetLabel(target)} ${formatAlarmMode(armedMode).toLowerCase()}`);
    }, 2800);
    armingTimers.current.push(timer);
  }

  function disarm() {
    cancelArmingTimers();
    const areas = selectedAreas();
    setState((current) => ({
      ...current,
      panic: null,
      alarms: { ...current.alarms, ...Object.fromEntries(areas.map((area) => [area, "disarmed"])) },
    }));
    setPinOpen(false);
    notify(`${targetLabel(target)} disarmed — simulation only`);
  }

  function confirmPanic() {
    if (!panicModal) return;
    cancelArmingTimers();
    const kind = panicModal;
    const areas = selectedAreas();
    setState((current) => ({
      ...current,
      panic: kind,
      alarms: kind === "audible"
        ? { ...current.alarms, ...Object.fromEntries(areas.map((area) => [area, "triggered"])) }
        : current.alarms,
    }));
    setPanicModal(null);
    notify(kind === "audible" ? "Audible panic preview activated" : "Silent alert preview activated — no sirens");
  }

  function toggleLight(id: string) {
    setState((current) => ({ ...current, lights: { ...current.lights, [id]: !current.lights[id] } }));
  }

  function clearAlert() {
    setPinOpen(true);
  }

  const clockReady = now.getTime() > 0;
  const time = useMemo(() => clockReady ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--:--", [clockReady, now]);
  const date = useMemo(() => clockReady ? now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "Initializing", [clockReady, now]);
  const areaSummary = state.alarms.house === state.alarms.outbuilding
    ? formatAlarmMode(state.alarms.house)
    : "Mixed state";

  return (
    <main className={`${styles.panelShell} ${state.panic ? styles.panelShellAlert : ""}`}>
      <div className={styles.gridTexture} aria-hidden="true" />
      <header className={styles.header}>
        <Brand />
        <div className={styles.panelTabs} role="tablist" aria-label="Preview panel location">
          {(Object.keys(panelConfigs) as PanelId[]).map((id) => (
            <button type="button" role="tab" aria-selected={panelId === id} className={panelId === id ? styles.panelTabActive : ""} key={id} onClick={() => selectPanel(id)}>
              <span>{id === "front" ? "01" : id === "bedroom" ? "02" : "03"}</span>{panelConfigs[id].shortLabel}
            </button>
          ))}
        </div>
        <div className={styles.clock}>
          <div><strong>{time}</strong><span>{date}</span></div>
          <span className={styles.simulationBadge}><StatusDot tone="amber" /> Simulation</span>
        </div>
      </header>

      <section className={styles.contextBar} aria-label="Panel and system status">
        <div className={styles.location}><span>Panel 0{panelId === "front" ? "1" : panelId === "bedroom" ? "2" : "3"}</span><strong>{config.location}</strong></div>
        <div className={styles.systemPills}>
          <div><StatusDot tone={state.alarms.house === "disarmed" ? "green" : state.alarms.house === "triggered" ? "red" : "cyan"} /><span>House</span><strong>{formatAlarmMode(state.alarms.house)}</strong></div>
          <div><StatusDot tone={state.alarms.outbuilding === "disarmed" ? "green" : state.alarms.outbuilding === "triggered" ? "red" : "cyan"} /><span>Building</span><strong>{formatAlarmMode(state.alarms.outbuilding)}</strong></div>
          <div className={styles.compactStatus}><StatusDot tone="green" /><span>Doors</span><strong>Secure</strong></div>
          <div className={styles.compactStatus}><StatusDot tone="green" /><span>Locks</span><strong>2 / 2</strong></div>
        </div>
      </section>

      {state.panic && (
        <section className={`${styles.alertBanner} ${state.panic === "silent" ? styles.alertBannerSilent : ""}`} role="alert">
          <strong>{state.panic === "audible" ? "Audible panic preview active" : "Silent alert preview active"}</strong>
          <span>{state.panic === "audible" ? "Simulated siren outputs are marked active." : "No siren or emergency service has been contacted."}</span>
          <button type="button" onClick={clearAlert}>Reset with PIN</button>
        </section>
      )}

      <div className={styles.workspace}>
        <section className={styles.securityCard} aria-labelledby="security-heading">
          <div className={styles.sectionHeader}>
            <div><span>Alarm command</span><h1 id="security-heading">Security modes</h1></div>
            <div className={styles.overallState}><span>Property</span><strong>{areaSummary}</strong></div>
          </div>

          <div className={styles.targetSelector} aria-label="Alarm control target">
            <span>Control target</span>
            <div>{targets.map((item) => <button type="button" key={item.id} className={target === item.id ? styles.targetActive : ""} onClick={() => setTarget(item.id)} aria-pressed={target === item.id}>{item.label}</button>)}</div>
          </div>

          <div className={styles.actionGrid}>
            <button className={styles.actionButton} type="button" onClick={() => arm("away")}>
              <span className={styles.actionCode}>AW</span><span className={styles.actionCopy}><strong>Arm away</strong><small>Perimeter + motion</small></span>
            </button>
            <button className={styles.actionButton} type="button" onClick={() => arm("home")}>
              <span className={styles.actionCode}>HM</span><span className={styles.actionCopy}><strong>Arm home</strong><small>Perimeter only</small></span>
            </button>
            <button className={styles.actionButton} type="button" onClick={() => arm("night")}>
              <span className={styles.actionCode}>NT</span><span className={styles.actionCopy}><strong>Sleep</strong><small>Night profile</small></span>
            </button>
            <button className={`${styles.actionButton} ${styles.actionButtonDisarm}`} type="button" onClick={() => setPinOpen(true)}>
              <span className={styles.actionCode}>DS</span><span className={styles.actionCopy}><strong>Disarm</strong><small>PIN required</small></span>
            </button>
            <HoldAction kind="audible" onComplete={() => setPanicModal("audible")} />
            <HoldAction kind="silent" onComplete={() => setPanicModal("silent")} />
          </div>

          <div className={styles.securityFooter}>
            <span><StatusDot tone="amber" /> 7 perimeter sensors planned</span>
            <span><StatusDot tone="amber" /> 3 siren outputs planned</span>
            <span className={styles.notMonitored}>Preview / Not monitored</span>
          </div>
        </section>

        <aside className={styles.controlsColumn}>
          <section className={styles.climateCard} aria-labelledby="climate-heading">
            <div className={styles.cardLabel}><span>Climate</span><strong id="climate-heading">{config.temperatureLabel}</strong></div>
            <div className={styles.climateBody}>
              <div className={styles.currentTemperature}><span>Indoor</span><strong>72<sup>°</sup></strong><small>48% humidity</small></div>
              <div className={styles.targetTemperature}><span>Target / Auto</span><div><button type="button" onClick={() => setState((current) => ({ ...current, targetTemperature: Math.max(60, current.targetTemperature - 1) }))} aria-label="Lower temperature">−</button><strong>{state.targetTemperature}°</strong><button type="button" onClick={() => setState((current) => ({ ...current, targetTemperature: Math.min(80, current.targetTemperature + 1) }))} aria-label="Raise temperature">+</button></div></div>
            </div>
          </section>

          <section className={styles.lightsCard} aria-labelledby="lights-heading">
            <div className={styles.cardLabel}><span>Quick controls</span><strong id="lights-heading">Lights &amp; devices</strong></div>
            <div className={styles.lightGrid}>
              {config.lights.map((light) => {
                const active = Boolean(state.lights[light.id]);
                return (
                  <button type="button" key={light.id} className={active ? styles.lightActive : ""} onClick={() => toggleLight(light.id)} aria-pressed={active}>
                    <span className={styles.lightGlyph}><i /></span>
                    <span><strong>{light.label}</strong><small>{active ? "On" : light.detail}</small></span>
                    <i className={styles.lightState}>{active ? "ON" : "OFF"}</i>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div><StatusDot tone="green" /><span>Panel online</span><small>PoE / LAN</small></div>
        <div><StatusDot tone="amber" /><span>Home Assistant</span><small>Binding pending</small></div>
        <div><StatusDot tone="amber" /><span>Network</span><small>Preview only</small></div>
        <div className={styles.footerMessage}><span>Simulation controls only</span><strong>Tomorrow: bind Alarmo + climate + lighting entities</strong></div>
      </footer>

      {pinOpen && <PinModal target={target} onCancel={() => setPinOpen(false)} onConfirm={disarm} />}
      {panicModal && <PanicModal kind={panicModal} target={target} onCancel={() => setPanicModal(null)} onConfirm={confirmPanic} />}
      {toast && <div className={styles.toast} role="status" aria-live="polite"><StatusDot tone="cyan" /><span>{toast}</span></div>}
    </main>
  );
}
