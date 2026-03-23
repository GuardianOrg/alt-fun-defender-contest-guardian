import styles from "./AuditsPage.module.css";
import { Guardian } from "../../assets/auditors/Guardian";
import { Obsidian } from "../../assets/auditors/Obsidian";
import { Phage } from "../../assets/auditors/Phage";
import { DownloadCloud } from "../../assets/DownloadCloud";
import Button from "../../components/Global/Buttons/Button";
import CorePageTitle from "../../components/Global/CorePageTitle/CorePageTitle";
import Seo from "../../components/Global/Seo";

const AuditsPage = () => {
  return (
    <div className={styles.auditsPage}>
      <Seo
        title="Audits"
        description="Audit reports for the Bounce protocol."
      />
      <CorePageTitle title="Audits" />
      <p className={styles.intro}>
        Our core contracts undergo independent security audits focused on
        correctness, economic safety, and exploit resistance.
      </p>
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.logoContainer}>
            <Guardian color={"var(--primary-500-or-white)"} />
          </div>
          <a href="https://guardianaudits.com/" target="_blank" rel="noopener">
            guardianaudits.com
          </a>
          <br />
          <div className={styles.auditReport}>
            Report 23/09/25
            <a href="/bounce-guardian-audit.pdf" target="_blank" rel="noopener">
              <Button variant="primary" size="small">
                <DownloadCloud />
              </Button>
            </a>
          </div>
          <div className={styles.auditReport}>
            Report 18/01/26
            <a
              href="/bounce-guardian-audit-2.pdf"
              target="_blank"
              rel="noopener"
            >
              <Button variant="primary" size="small">
                <DownloadCloud />
              </Button>
            </a>
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.logoContainer}>
            <Obsidian color={"var(--primary-500-or-white)"} />
          </div>
          <a
            href="https://www.obsidianaudits.com/about"
            target="_blank"
            rel="noopener"
          >
            obsidianaudits.com
          </a>
          <br />
          <div className={styles.auditReport}>
            Report 07/11/25
            <a href="/bounce-obsidian-audit.pdf" target="_blank" rel="noopener">
              <Button variant="primary" size="small">
                <DownloadCloud />
              </Button>
            </a>
          </div>
          <div className={styles.auditReport}>
            Report 09/01/26
            <a
              href="/bounce-obsidian-audit-2.pdf"
              target="_blank"
              rel="noopener"
            >
              <Button variant="primary" size="small">
                <DownloadCloud />
              </Button>
            </a>
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.logoContainer}>
            <Phage color={"var(--primary-500-or-white)"} />
          </div>
          <a
            href="https://www.phagesecurity.com/"
            target="_blank"
            rel="noopener"
          >
            phagesecurity.com
          </a>
          <br />
          <div className={styles.auditReport}>
            Report 31/08/25
            <a href="/bounce-phage-audit.pdf" target="_blank" rel="noopener">
              <Button variant="primary" size="small">
                <DownloadCloud />
              </Button>
            </a>{" "}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditsPage;
