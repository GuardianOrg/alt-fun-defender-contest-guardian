import { useEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { useDispatch } from "react-redux";
import { Link, useLocation } from "react-router";

import styles from "./Header.module.css";
import ThemeToggle from "./ThemeToggle/ThemeToggle";
import { trackEvent } from "../../../analytics/ga";
import {
  LOCK_ROUTE,
  MINT_ROUTE,
  PORTFOLIO_ROUTE,
  REGISTER_ROUTE,
  REWARDS_ROUTE,
  STAKE_ROUTE,
} from "../../../app/routes";
import { useFeatureFlags } from "../../../config/featureFlags";
import { useUserHasRegistered } from "../../../hooks/useUserHasRegistered";
import { setDepositIsOpen } from "../../../state/depositSlice";
import AnimatePresenceWidth from "../AnimatePresenceWidth/AnimatePresenceWidth";
import Button from "../Buttons/Button";
import Connector from "../Connector/Connector";
import Logo from "../Logo/Logo";
import Hamburger from "./Hamburger/Hamburger";
import Tooltip from "../Tooltip/Tooltip";

interface NavItem {
  label: string;
  route: string;
  enabled: boolean;
  show: boolean;
  shimmer?: boolean;
  customTooltip?: string;
}

const Header = () => {
  const dispatch = useDispatch();
  const { hasRegistered } = useUserHasRegistered();

  const {
    protocolLive,
    mintRoute,
    lockRoute,
    stakeRoute,
    portfolioRoute,
    rewardsRoute,
  } = useFeatureFlags();

  const navItems: NavItem[] = [
    {
      label: "Mint",
      route: MINT_ROUTE,
      enabled: mintRoute,
      show: protocolLive,
    },
    {
      label: "Portfolio",
      route: PORTFOLIO_ROUTE,
      enabled: portfolioRoute,
      show: protocolLive,
    },
    {
      label: "Register",
      route: REGISTER_ROUTE,
      enabled: true,
      show: true,
    },
    { label: "Lock", route: LOCK_ROUTE, enabled: true, show: lockRoute },
    { label: "Stake", route: STAKE_ROUTE, enabled: true, show: stakeRoute },
    {
      label: "Rewards",
      route: REWARDS_ROUTE,
      enabled: rewardsRoute,
      show: protocolLive,
      shimmer: true,
      customTooltip: "Tracking",
    },
  ];

  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = () => setMenuOpen((prev) => !prev);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 900 && menuOpen) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [menuOpen]);

  const dropdownVariants = {
    hidden: { opacity: 0, y: -20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  };

  const isActive = (route: string) => {
    const baseRoute = route.split("/:")[0];
    return location.pathname.startsWith(`/${baseRoute}`);
  };

  return (
    <div className={styles.headerContainer}>
      <header className={`${styles.header} ${menuOpen ? styles.open : ""}`}>
        <div className={styles.container}>
          {protocolLive && (
            <div className={styles.hamburgerContainer}>
              <Hamburger open={menuOpen} onToggle={toggleMenu} />
            </div>
          )}
          <Logo setMenuOpen={setMenuOpen} iconOnMobile />
        </div>
        <div className={styles.section}>
          <nav className={styles.nav}>
            {navItems
              .filter(({ show }) => show)
              .map((item) => {
                const { label, route, enabled, shimmer, customTooltip } = item;

                return enabled ? (
                  <Link
                    key={route}
                    className={`${styles.navLink} ${
                      isActive(route) ? styles.activeNavLink : ""
                    } ${shimmer ? styles.shimmer : undefined}`}
                    to={route}
                  >
                    {label}
                  </Link>
                ) : (
                  <Tooltip content={customTooltip || "Coming Soon"} key={route}>
                    <div
                      className={`${styles.navLink} ${styles.disabledNavLink} ${shimmer ? styles.shimmer : undefined}`}
                    >
                      {label}
                    </div>
                  </Tooltip>
                );
              })}
          </nav>
          <div className={styles.themeToggleContainer}>
            <ThemeToggle />
          </div>
          <div className={styles.ctas}>
            <AnimatePresenceWidth shouldDisplay={!!hasRegistered}>
              <Button
                variant="secondary"
                rounded
                size="small"
                onClick={() => {
                  dispatch(setDepositIsOpen(true));
                  trackEvent("deposit_action", {
                    label: "deposit_modal_opened",
                    location: "header",
                  });
                }}
              >
                Bridge
              </Button>
            </AnimatePresenceWidth>
            <Connector setMenuOpen={setMenuOpen} />
          </div>
        </div>
      </header>
      <div
        className={`${styles.dropdownBackground} ${
          menuOpen ? styles.openBackground : ""
        }`}
        onClick={toggleMenu}
        data-testid="dropdownBackground"
      />
      <AnimatePresence>
        {menuOpen && protocolLive && (
          <motion.nav
            className={styles.dropdownNav}
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={dropdownVariants}
            transition={{ duration: 0.25, ease: "easeOut" }}
            data-testid="dropdownNav"
          >
            {navItems
              .filter(({ show }) => show)
              .map((item) => {
                const { label, route, enabled, shimmer, customTooltip } = item;

                return enabled ? (
                  <Link
                    key={route}
                    className={`${styles.dropdownNavLink} ${
                      isActive(route) ? styles.activeDropdownNavLink : ""
                    }  ${shimmer ? styles.shimmer : undefined}`}
                    to={route}
                    onClick={() => setMenuOpen(false)}
                  >
                    {label}
                  </Link>
                ) : (
                  <Tooltip content={customTooltip || "Coming Soon"} key={route}>
                    <div
                      className={`${styles.dropdownNavLink} ${styles.disabledNavLink}  ${shimmer ? styles.shimmer : undefined}`}
                    >
                      {label}
                    </div>
                  </Tooltip>
                );
              })}
            <ThemeToggle />
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Header;
