import { useState, useEffect, useRef } from "react";

import styles from "./TradePanel.module.css";
import { SLIPPAGE_OPTIONS } from "../../config/constants";
import { cn } from "../../utils/format";

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
        <button className={styles.settingsCloseBtn} onClick={onClose}>
          [Close]
        </button>
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
            <button
              key={p}
              className={cn(
                styles.presetBtn,
                slippage === p / 100 && styles.presetBtnActive,
              )}
              onClick={() => {
                onSlippageChange(p / 100);
                setCustom(String(p));
              }}
            >
              {p}%
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
