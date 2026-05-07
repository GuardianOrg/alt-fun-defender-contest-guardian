import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router";

import styles from "./Header.module.css";
import { CREATE_PATH } from "../../app/routes";
import { useWallet } from "../../hooks/useWallet";
import { setSearchOpen, setEarningsOpen } from "../../state/uiSlice";
import AltFunLogo from "../../assets/AltFunLogo/AltFunLogo";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { isConnected, address, shortAddress, connect } = useWallet();
  const tinyAddress = address ? `${address.slice(0, 5)}…` : undefined;

  const isCreate = location.pathname === CREATE_PATH;

  return (
    <header className={styles.header}>
      <div className={styles.logo} onClick={() => navigate("/")}>
        <AltFunLogo size={36} />
      </div>

      {!isCreate && (
        <div
          className={styles.searchTrigger}
          onClick={() => dispatch(setSearchOpen(true))}
        >
          <svg
            className={styles.searchIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className={styles.searchText}>Search for altcoins&hellip;</span>
          <span className={styles.searchKbd}>⌘K</span>
        </div>
      )}

      <div className={styles.rightSide}>
        {isConnected ? (
          <button
            className={styles.walletAddress}
            onClick={() => dispatch(setEarningsOpen(true))}
          >
            <span className={styles.fullText}>{shortAddress}</span>
            <span className={styles.shortText}>{tinyAddress}</span>
          </button>
        ) : (
          <button className={styles.walletAddress} onClick={connect}>
            Connect Wallet
          </button>
        )}
        {isConnected &&
          (isCreate ? (
            <button className={styles.creatingBtn}>
              <span>+</span>
              <span>creating token</span>
            </button>
          ) : (
            <button
              className={styles.launchBtn}
              onClick={() => navigate(CREATE_PATH)}
            >
              <span>+</span>
              <span className={styles.fullText}>create a levered token</span>
              <span className={styles.shortText}>create</span>
            </button>
          ))}
      </div>
    </header>
  );
}
