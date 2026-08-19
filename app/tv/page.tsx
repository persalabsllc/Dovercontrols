import TvClock from "./TvClock";
import styles from "./tv.module.css";

type Tone = "green" | "cyan" | "amber" | "red";
type Scene = "entry" | "driveway" | "rear" | "building";

type CameraPosition = {
  id: string;
  label: string;
  location: string;
  scene: Scene;
  zone: string;
};

const cameraPositions: CameraPosition[] = [
  { id: "CAM 01", label: "Front entry", location: "Main approach", scene: "entry", zone: "HOUSE / NORTH" },
  { id: "CAM 02", label: "Driveway", location: "Vehicle approach", scene: "driveway", zone: "HOUSE / EAST" },
  { id: "CAM 03", label: "Rear perimeter", location: "Back yard", scene: "rear", zone: "HOUSE / SOUTH" },
  { id: "CAM 04", label: "Mission building", location: "Detached structure", scene: "building", zone: "OUTBUILDING" },
];

function StatusDot({ tone }: { tone: Tone }) {
  return <span className={`${styles.statusDot} ${styles[`statusDot_${tone}`]}`} aria-hidden="true" />;
}

function Brand() {
  return (
    <div className={styles.brand}>
      <div className={styles.brandMark} aria-hidden="true"><span>DC</span><i /></div>
      <div>
        <strong>Dover Controls</strong>
        <span>Property intelligence display</span>
      </div>
    </div>
  );
}

function CameraPlaceholder({ camera }: { camera: CameraPosition }) {
  return (
    <article className={styles.cameraCard} aria-label={`${camera.label} camera position. UniFi Protect feed not yet commissioned.`}>
      <div className={styles.cameraHeader}>
        <div>
          <span>{camera.id}</span>
          <strong>{camera.label}</strong>
        </div>
        <span className={styles.feedState}><StatusDot tone="amber" /> Feed reserved</span>
      </div>

      <div className={`${styles.scene} ${styles[`scene_${camera.scene}`]}`} aria-hidden="true">
        <i className={styles.sceneGlow} />
        <i className={styles.sceneGround} />
        <i className={styles.sceneStructure} />
        <i className={styles.scenePath} />
        <i className={styles.sceneMarker} />
        <span className={styles.reticle}><i /><b /></span>
        <span className={styles.scanLine} />
        <span className={styles.sceneGrid} />
      </div>

      <div className={styles.cameraFooter}>
        <span>{camera.zone}</span>
        <strong>{camera.location}</strong>
        <small>Awaiting UniFi Protect</small>
      </div>
    </article>
  );
}

function AlarmState({ label, state, detail, tone }: { label: string; state: string; detail: string; tone: Tone }) {
  return (
    <div className={`${styles.alarmState} ${styles[`alarmState_${tone}`]}`}>
      <div><StatusDot tone={tone} /><span>{label}</span></div>
      <strong>{state}</strong>
      <small>{detail}</small>
    </div>
  );
}

function LockRow({ label, detail }: { label: string; detail: string }) {
  return (
    <li>
      <span className={styles.lockGlyph} aria-hidden="true"><i /></span>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <b><StatusDot tone="green" /> Locked</b>
    </li>
  );
}

export default function DoverWatchPreview() {
  return (
    <main className={styles.displayShell}>
      <div className={styles.gridTexture} aria-hidden="true" />
      <div className={styles.cornerFrame} aria-hidden="true" />

      <header className={styles.header}>
        <Brand />
        <div className={styles.headerCenter}>
          <span>Dover Residence / Property Overview</span>
          <strong>WATCH STATION 01</strong>
        </div>
        <TvClock />
      </header>

      <section className={styles.overviewStrip} aria-label="Property status summary">
        <div><span>Property</span><strong><StatusDot tone="green" /> Secure</strong><small>0 open zones</small></div>
        <div><span>Alarm areas</span><strong><StatusDot tone="cyan" /> 1 armed</strong><small>House + outbuilding</small></div>
        <div><span>Locks</span><strong><StatusDot tone="green" /> 3 secured</strong><small>No access faults</small></div>
        <div><span>Climate</span><strong>72<sup>°</sup>F</strong><small>Target 70° / Auto</small></div>
        <div><span>Display authority</span><strong><StatusDot tone="cyan" /> View only</strong><small>Command path disabled</small></div>
      </section>

      <div className={styles.workspace}>
        <section className={styles.cameraSection} aria-labelledby="camera-heading">
          <div className={styles.sectionHeading}>
            <div><span>Protect surveillance</span><h1 id="camera-heading">Exterior camera matrix</h1></div>
            <div className={styles.matrixStatus}><StatusDot tone="amber" /><span>4 feeds reserved</span><small>Medium stream profile planned</small></div>
          </div>

          <div className={styles.cameraGrid}>
            {cameraPositions.map((camera) => <CameraPlaceholder camera={camera} key={camera.id} />)}
          </div>

          <div className={styles.eventRibbon}>
            <span><StatusDot tone="green" /> No active security event</span>
            <strong>Sample state</strong>
            <small>Doorbell and person events will focus the relevant camera automatically</small>
          </div>
        </section>

        <aside className={styles.statusRail} aria-label="Security and climate status">
          <section className={styles.railCard} aria-labelledby="alarms-heading">
            <div className={styles.cardHeading}><span>Security partitions</span><h2 id="alarms-heading">Alarm status</h2></div>
            <div className={styles.alarmGrid}>
              <AlarmState label="House" state="Disarmed" detail="All perimeter zones ready" tone="green" />
              <AlarmState label="Outbuilding" state="Armed away" detail="Perimeter + interior motion" tone="cyan" />
            </div>
          </section>

          <section className={styles.railCard} aria-labelledby="locks-heading">
            <div className={styles.cardHeading}><span>Access control</span><h2 id="locks-heading">Entry locks</h2></div>
            <ul className={styles.lockList}>
              <LockRow label="Front entry" detail="Main residence" />
              <LockRow label="Rear entry" detail="Main residence" />
              <LockRow label="Mission building" detail="Detached structure" />
            </ul>
          </section>

          <section className={`${styles.railCard} ${styles.climateCard}`} aria-labelledby="climate-heading">
            <div className={styles.cardHeading}><span>Environmental</span><h2 id="climate-heading">Climate</h2></div>
            <div className={styles.climateGrid}>
              <div><span>Residence</span><strong>72<sup>°</sup></strong><small>48% RH · Auto</small></div>
              <div><span>Outbuilding</span><strong>68<sup>°</sup></strong><small>51% RH · Normal</small></div>
            </div>
          </section>

          <section className={`${styles.railCard} ${styles.linkCard}`} aria-labelledby="system-heading">
            <div className={styles.cardHeading}><span>Data sources</span><h2 id="system-heading">System link</h2></div>
            <div className={styles.linkRows}>
              <div><span><StatusDot tone="amber" /> Home Assistant</span><strong>Binding pending</strong></div>
              <div><span><StatusDot tone="amber" /> UniFi Protect</span><strong>Binding pending</strong></div>
              <div><span><StatusDot tone="cyan" /> Dover Watch</span><strong>Preview active</strong></div>
            </div>
          </section>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div><StatusDot tone="cyan" /><strong>Read-only display</strong><span>No arm, disarm or unlock actions available</span></div>
        <div><span>Local runtime planned</span><strong>Raspberry Pi / HDMI / Ethernet</strong></div>
        <div><span>Commissioning state</span><strong>Interface ready · Entity binding pending</strong></div>
      </footer>
    </main>
  );
}
