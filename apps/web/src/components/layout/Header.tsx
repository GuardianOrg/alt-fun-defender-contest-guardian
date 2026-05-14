import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";

import styles from "./Header.module.css";
import { CREATE_PATH, PROFILE_PATH } from "../../app/routes";
import AltFunLogo from "../../assets/AltFunLogo/AltFunLogo";
import { useWallet } from "../../hooks/useWallet";
import { setSearchOpen } from "../../state/uiSlice";
import Button from "../shared/Button";
import Chip from "../shared/Chip";

export default function Header() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { isConnected, connect } = useWallet();

  return (
    <header className={styles.header}>
      <div className={styles.logo} onClick={() => navigate("/")}>
        <AltFunLogo size={36} />
      </div>

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
      </div>

      <div className={styles.rightSide}>
        {!isConnected && (
          <Button
            variant="primary"
            size="sm"
            className={styles.connectBtn}
            onClick={connect}
          >
            Connect Wallet
          </Button>
        )}
        {isConnected && (
          <Chip
            className={styles.headerChip}
            onClick={() => navigate(PROFILE_PATH)}
            aria-label="Open profile"
          >
            Profile
          </Chip>
        )}
        {isConnected && (
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
