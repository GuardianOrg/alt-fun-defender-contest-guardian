import { useState, type FormEvent, type ReactNode } from "react";

import styles from "./PasswordGate.module.css";

const PASS = "launchpad2026";
const STORAGE_KEY = "lp_auth";

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(STORAGE_KEY) === "1",
  );
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === PASS) {
      sessionStorage.setItem(STORAGE_KEY, "1");
      setAuthed(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
    }
  };

  if (authed) return <>{children}</>;

  return (
    <div className={styles.wrapper}>
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.logoText}>
          <span className={styles.logoMint}>LAUNCH</span>
          <span className={styles.logoTxt}>PAD</span>
        </div>
        <div className={styles.subtitle}>internal preview</div>

        <input
          className={styles.input}
          type="password"
          placeholder="Password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />

        {error && <div className={styles.error}>Wrong password</div>}

        <button type="submit" className={styles.submitBtn}>
          Enter
        </button>
      </form>
    </div>
  );
}
