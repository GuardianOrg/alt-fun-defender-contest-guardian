import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router";

import styles from "./Header.module.css";
import { CREATE_PATH } from "../../app/routes";
import AltFunLogo from "../../assets/AltFunLogo/AltFunLogo";
import { useWallet } from "../../hooks/useWallet";
import { setSearchOpen, setEarningsOpen } from "../../state/uiSlice";
import { SEARCH_SHORTCUT_LABEL } from "../../utils/platform";
import Button from "../shared/Button";
import Chip from "../shared/Chip";

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
          <span className={styles.searchKbd}>{SEARCH_SHORTCUT_LABEL}</span>
        </div>
      )}

      <div className={styles.rightSide}>
        {isConnected ? (
          <Chip
            className={styles.walletChip}
            onClick={() => dispatch(setEarningsOpen(true))}
            aria-label="Open profile and earnings"
          >
            <span className={styles.fullText}>{shortAddress}</span>
            <span className={styles.shortText}>{tinyAddress}</span>
          </Chip>
        ) : (
          <Button variant="primary" size="sm" onClick={connect}>
            Connect Wallet
          </Button>
        )}
        {isConnected && !isCreate && (
          <Button
            variant="primary"
            size="sm"
            className={styles.launchBtn}
            onClick={() => navigate(CREATE_PATH)}
          >
            <span>+</span>
            <span className={styles.fullText}>create an altcoin</span>
            <span className={styles.shortText}>create</span>
          </Button>
        )}
      </div>
    </header>
  );
}
