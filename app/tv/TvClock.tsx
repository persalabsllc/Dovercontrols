"use client";

import { useEffect, useState } from "react";
import styles from "./tv.module.css";

export default function TvClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const firstTick = window.setTimeout(() => setNow(new Date()), 0);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(clock);
    };
  }, []);

  const time = now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) ?? "--:--";
  const date = now?.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  }) ?? "Initializing local display";

  return (
    <div className={styles.clock}>
      <div>
        <strong>{time}</strong>
        <span>{date}</span>
      </div>
      <span className={styles.previewBadge}>
        <i className={`${styles.statusDot} ${styles.statusDot_amber}`} aria-hidden="true" />
        Simulation
      </span>
    </div>
  );
}
