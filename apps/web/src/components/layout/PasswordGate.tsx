import { useState, type FormEvent, type ReactNode } from "react";

import styles from "./PasswordGate.module.css";
import Button from "../shared/Button";

const PASS = import.meta.env.VITE_GATE_PASSWORD;
const STORAGE_KEY = "af_auth";

const isLocalhost = () =>
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(
    () => !PASS || isLocalhost() || sessionStorage.getItem(STORAGE_KEY) === "1",
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
          <span className={styles.logoMint}>ALT</span>
          <span className={styles.logoTxt}>FUN</span>
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

        <Button variant="primary" fullWidth type="submit">
          Enter
        </Button>
      </form>
    </div>
  );
}
