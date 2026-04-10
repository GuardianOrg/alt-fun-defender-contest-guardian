import { Link } from "react-router";

import styles from "./Audits.module.css";
import { Guardian } from "../../../assets/auditors/Guardian";
import { Obsidian } from "../../../assets/auditors/Obsidian";
import { Phage } from "../../../assets/auditors/Phage";

const Audits = () => {
  return (
    <div className={styles.auditsContainer}>
      <h2 className={styles.title}>Security-first by design.</h2>
      <div className={styles.innerContainer}>
        <div className={styles.text}>
          <p>
            The Bounce protocol has undergone six audits from three independent
            top auditors. Security is, and will always be, the top priority of
            the team.
          </p>

          <Link to="/audits">Read our reports</Link>
        </div>
        <div className={styles.logos}>
          <a
            href="https://guardianaudits.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Guardian color={"var(--primary-500-or-white)"} />
          </a>
          <a
            href="https://www.obsidianaudits.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Obsidian color={"var(--primary-500-or-white)"} />
          </a>
          <a
            href="https://www.phagesecurity.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Phage color={"var(--primary-500-or-white)"} />
          </a>
        </div>
      </div>
    </div>
  );
};

export default Audits;
