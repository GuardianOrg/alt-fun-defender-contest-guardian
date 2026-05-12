import { useState, useEffect, useRef } from "react";

import styles from "./TradePanel.module.css";
import { SLIPPAGE_OPTIONS } from "../../config/constants";
import IconButton from "../shared/IconButton";
import PresetChip from "../shared/PresetChip";

interface Props {
  slippage: number;
  onSlippageChange: (v: number) => void;
  onClose: () => void;
}

export default function SettingsPopup({
  slippage,
  onSlippageChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(String(slippage * 100));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const presets = SLIPPAGE_OPTIONS.map((s) => s * 100);

  const applyCustom = (val: string) => {
    setCustom(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0 && n <= 50) {
      onSlippageChange(n / 100);
    }
  };

  return (
    <div ref={ref} className={styles.settingsPopup}>
      <div className={styles.settingsHeader}>
        <span className={styles.settingsTitle}>Settings</span>
        <IconButton
          onClick={onClose}
          aria-label="Close settings"
          flush
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </IconButton>
      </div>

      <div>
        <div className={styles.slippageLabel}>Max slippage (%)</div>
        <div className={styles.slippageInputWrap}>
          <input
            className={styles.slippageInput}
            type="number"
            value={custom}
            onChange={(e) => applyCustom(e.target.value)}
            min="0.1"
            max="50"
            step="0.1"
          />
          <span className={styles.percentSign}>%</span>
        </div>
        <div className={styles.slippageHint}>
          Maximum price change you&apos;re willing to accept when placing
          trades.
        </div>
        <div className={styles.presetRow}>
          {presets.map((p) => (
            <PresetChip
              key={p}
              fluid
              active={slippage === p / 100}
              onClick={() => {
                onSlippageChange(p / 100);
                setCustom(String(p));
              }}
            >
              {p}%
            </PresetChip>
          ))}
        </div>
      </div>
    </div>
  );
}
