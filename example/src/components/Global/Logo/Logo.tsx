import { Link } from "react-router";

import styles from "./Logo.module.css";
import icon from "../../../assets/bounce-icon-black.svg";
import logo from "../../../assets/logo-full.svg";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { useTheme } from "../../../hooks/useTheme";

interface LogoProps {
  inverted?: boolean;
  large?: boolean;
  wideOnMobile?: boolean;
  iconOnMobile?: boolean;
  setMenuOpen?: (next: boolean) => void;
}

const Logo = ({
  inverted,
  large,
  wideOnMobile,
  iconOnMobile,
  setMenuOpen,
}: LogoProps) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const isMobile = useIsMobile(400);
  const showIcon = isMobile && iconOnMobile;

  return (
    <Link
      to="/"
      className={`${styles.logoLink} ${
        wideOnMobile ? styles.wideOnMobileLink : ""
      } ${showIcon ? styles.mobileIcon : ""}`}
      onClick={() => setMenuOpen?.(false)}
      data-testid="logoLink"
    >
      <img
        src={showIcon ? icon : logo}
        alt="Logo"
        className={[
          styles.logoImage,
          large && styles.largeImage,
          (inverted || isDark) && styles.invertedImage,
          wideOnMobile && styles.wideOnMobileImage,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </Link>
  );
};

export default Logo;
