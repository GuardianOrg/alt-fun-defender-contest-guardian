import { Link } from "react-router";

import styles from "./Footer.module.css";
import {
  DISCORD_LINK,
  DOCS_LINK,
  GITHUB_LINK,
  X_LINK,
} from "../../../app/links";
import {
  BLOG_ROUTE,
  PRIVACY_POLICY_ROUTE,
  TERMS_OF_SERVICE_ROUTE,
  AUDITS_ROUTE,
} from "../../../app/routes";
import footerIllustration from "../../../assets/footer-illustration.svg";
import ComingSoon from "../ComingSoon/ComingSoon";
import Logo from "../Logo/Logo";

interface FooterLink {
  label: string;
  path: string;
  external?: boolean;
  comingSoon?: boolean;
}

interface FooterSection {
  header: string;
  links: FooterLink[];
}

const FOOTER_SECTIONS: FooterSection[] = [
  {
    header: "Socials",
    links: [
      { label: "Twitter", path: X_LINK, external: true },
      { label: "Discord", path: DISCORD_LINK, external: true },
    ],
  },
  {
    header: "Protocol",
    links: [
      { label: "Docs", path: DOCS_LINK, external: true },
      { label: "GitHub", path: GITHUB_LINK, external: true },
      { label: "Terms of Service", path: TERMS_OF_SERVICE_ROUTE },
      { label: "Privacy Policy", path: PRIVACY_POLICY_ROUTE },
      { label: "Audits", path: AUDITS_ROUTE },
    ],
  },
  {
    header: "News",
    links: [{ label: "Blog", path: BLOG_ROUTE }],
  },
];

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <img className={styles.illustration} src={footerIllustration} />
      <div className={styles.footerContent}>
        <div className={styles.footerSection}>
          <Logo inverted large wideOnMobile />
          <p
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className={styles.copyright}
          >
            © {currentYear} Bounce Tech
          </p>
        </div>
        {FOOTER_SECTIONS.map((section) => (
          <div className={styles.footerSection} key={section.header}>
            <div className={styles.header}>{section.header}</div>
            {section.links.map((link) => {
              return link.external ? (
                <div key={link.label}>
                  <ComingSoon comingSoon={link.comingSoon || false}>
                    <a
                      href={link.path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.externalLink}
                    >
                      {link.label}
                    </a>
                  </ComingSoon>
                </div>
              ) : (
                <div key={link.label}>
                  <ComingSoon comingSoon={link.comingSoon || false}>
                    <Link className={styles.internalLink} to={link.path}>
                      {link.label}
                    </Link>
                  </ComingSoon>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </footer>
  );
};

export default Footer;
