"use client";

import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

const STEPS = [0, 1, 2, 3] as const;

/**
 * Jev's self-assessed danger, 0 (safe) to 3 (losing). `null` means the model
 * never answered, which is deliberately shown as an empty bar rather than as
 * the reassuring 0.
 */
export function DangerMeter() {
  const danger = useGameStore((state) => state.lastAi?.danger ?? null);

  const step = danger === null ? null : Math.min(3, Math.max(0, Math.round(danger)));
  const label = step === null ? UI.danger.unknown : (UI.danger.levels[step] ?? UI.danger.unknown);
  const filled = step === null ? 0 : step + 1;

  return (
    <div className="danger">
      <div className="danger__head">
        <span className="danger__label">{UI.danger.label}</span>
        <span className="danger__value" data-unknown={step === null ? "" : undefined}>
          {label}
        </span>
      </div>
      <div
        className="danger__bar"
        role="meter"
        aria-label={UI.danger.label}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={filled}
        aria-valuetext={label}
      >
        {STEPS.map((index) => (
          <span
            key={index}
            className="danger__cell"
            data-on={index < filled ? "" : undefined}
            data-level={index}
          />
        ))}
      </div>
    </div>
  );
}
