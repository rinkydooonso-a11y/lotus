"use client";
import { useAuth } from "@/lib/auth/client";

/** Second half of the Phantom deeplink login: back from connecting, one tap opens Phantom to sign. */
export function PhantomSignSheet() {
  const { user, phantomSign, continuePhantomSign, cancelPhantom, busy, error } = useAuth();
  if (user || (!phantomSign && !busy)) return null;
  return (
    <div className="sheet-back" onClick={busy ? undefined : cancelPhantom}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {busy ? (
          <h2>Signing you in…</h2>
        ) : phantomSign && (
          <>
            <h2>Connected {phantomSign.address.slice(0, 4)}…{phantomSign.address.slice(-4)}</h2>
            <p className="muted">One more step: sign a free message in Phantom to log in. No transaction, no fees.</p>
            <button className="btn wide" disabled={!phantomSign.ready} onClick={continuePhantomSign}>{phantomSign.ready ? "Sign in with Phantom" : "Preparing…"}</button>
          </>
        )}
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
