import { useState, type FormEvent, type ReactNode } from 'react';

const PASS = 'bounce2026';
const STORAGE_KEY = 'bf_auth';

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(STORAGE_KEY) === '1');
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === PASS) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setAuthed(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
    }
  };

  if (authed) return <>{children}</>;

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <form onSubmit={submit} className="flex flex-col items-center gap-5 w-[280px]">
        <div className="text-sm font-bold tracking-[0.08em]">
          <span className="text-mint drop-shadow-[0_0_8px_rgba(77,232,180,0.4)]">BOUNCE</span>
          <span className="text-txt font-bold">.FUN</span>
        </div>
        <div className="text-[11px] text-txt-3 tracking-[0.14em] uppercase">internal preview</div>

        <input
          className="w-full bg-bg-2 border border-border rounded-[3px] px-3 py-2.5 font-mono text-sm text-txt placeholder:text-txt-4 outline-none focus:border-border-2 transition-all"
          type="password"
          placeholder="Password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />

        {error && (
          <div className="text-[13px] text-red">Wrong password</div>
        )}

        <button
          type="submit"
          className="w-full py-2.5 rounded-[3px] border-0 font-mono text-[13px] font-bold tracking-[0.08em] uppercase cursor-pointer bg-mint text-bg shadow-mint-glow hover:bg-mint-hover transition-all"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
