import { useRef, useState } from "react";

import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router";

import AddressMenu from "./AddressMenu";
import styles from "./Header.module.css";
import { CREATE_PATH, PROFILE_PATH } from "../../app/routes";
import AltFunLogo from "../../assets/AltFunLogo/AltFunLogo";
import { useWallet } from "../../hooks/useWallet";
import { setSearchOpen } from "../../state/uiSlice";
import { SEARCH_SHORTCUT_LABEL } from "../../utils/platform";
import Button from "../shared/Button";
import Chip from "../shared/Chip";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { isConnected, address, shortAddress, connect, disconnect } =
    useWallet();
  const tinyAddress = address ? `${address.slice(0, 5)}…` : undefined;
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const walletChipWrapRef = useRef<HTMLDivElement>(null);

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
        {isConnected && address ? (
          <div ref={walletChipWrapRef} className={styles.walletChipWrap}>
            <Chip
              className={styles.headerChip}
              onClick={() => setAddressMenuOpen((prev) => !prev)}
              aria-label="Wallet address menu"
              aria-haspopup="menu"
              aria-expanded={addressMenuOpen}
            >
              <span className={styles.fullText}>{shortAddress}</span>
              <span className={styles.shortText}>{tinyAddress}</span>
            </Chip>
            {addressMenuOpen && (
              <AddressMenu
                address={address}
                anchorRef={walletChipWrapRef}
                onDisconnect={() => {
                  void disconnect();
                }}
                onClose={() => setAddressMenuOpen(false)}
              />
            )}
          </div>
        ) : (
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
