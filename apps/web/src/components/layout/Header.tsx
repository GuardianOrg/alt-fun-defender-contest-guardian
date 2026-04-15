import { useEffect, useState } from "react";

import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router";

import styles from "./Header.module.css";
import { CREATE_PATH } from "../../app/routes";
import { useWallet } from "../../hooks/useWallet";
import { setSearchOpen, setEarningsOpen } from "../../state/uiSlice";
import { cn } from "../../utils/format";

const TABS = [
  { label: "MARKETS", path: "/" },
  { label: "PROFILE", action: "earnings" as const },
];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { isConnected, shortAddress, connect } = useWallet();
  const [clock, setClock] = useState("--:--:-- UTC");

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setClock(
        `${String(n.getUTCHours()).padStart(2, "0")}:${String(n.getUTCMinutes()).padStart(2, "0")}:${String(n.getUTCSeconds()).padStart(2, "0")} UTC`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const isCreate = location.pathname === CREATE_PATH;

  return (
    <header className={styles.header}>
      <div className={styles.logo} onClick={() => navigate("/")}>
        <span className={styles.logoMint}>ALT</span>
        <span className={styles.logoTxt}>FUN</span>
      </div>

      <div className={styles.tagline}>
        <span className={styles.taglineMint}>leverage</span>
        <span className={styles.taglineSep}>&times;</span>
        <span className={styles.taglineTxt}>memes</span>
      </div>

      <nav className={styles.nav}>
        {TABS.map((tab) => {
          const hasPath = "path" in tab;
          const isActive =
            hasPath && tab.path === "/" && location.pathname === "/";
          return (
            <button
              key={tab.label}
              className={cn(
                styles.navButton,
                isActive && styles.navButtonActive,
              )}
              onClick={() => {
                if ("action" in tab && tab.action === "earnings") {
                  dispatch(setEarningsOpen(true));
                } else if (hasPath && tab.path !== "#") {
                  navigate(tab.path!);
                }
              }}
            >
              {tab.label}
              {isActive && <span className={styles.activeIndicator} />}
            </button>
          );
        })}
      </nav>

      {!isCreate && (
        <div
          className={styles.searchTrigger}
          onClick={() => dispatch(setSearchOpen(true))}
        >
          <span className={styles.searchIcon}>&#x2315;</span>
          <span className={styles.searchText}>Search tokens&hellip;</span>
          <span className={styles.searchKbd}>⌘K</span>
        </div>
      )}

      <div className={styles.rightSide}>
        <span className={styles.clock}>{clock}</span>
        {isConnected ? (
          <span
            className={styles.walletAddress}
            onClick={() => dispatch(setEarningsOpen(true))}
          >
            {shortAddress}
          </span>
        ) : (
          <button className={styles.connectButton} onClick={connect}>
            Connect Wallet
          </button>
        )}
        {isCreate ? (
          <button className={styles.creatingBtn}>
            &#x26A1; creating token
          </button>
        ) : (
          <button
            className={styles.launchBtn}
            onClick={() => navigate(CREATE_PATH)}
          >
            &#x26A1; launch a levered token
          </button>
        )}
      </div>
    </header>
  );
}
