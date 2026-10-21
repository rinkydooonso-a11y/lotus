"use client";
import { useAuth } from "@/lib/auth/client";
import { Mark } from "./Logo";
import { Sheet } from "./Sheet";

/** Second half of the Phantom deeplink login: back from connecting, one tap opens Phantom to sign. */
export function PhantomSignSheet() {
  const { user, phantomSign, continuePhantomSign, cancelPhantom, busy, error } = useAuth();
  if (user || (!phantomSign && !busy)) return null;
  return (
    <Sheet onClose={busy ? undefined : cancelPhantom} label="Sign in with Phantom">
      <div className="sheet-head">
        <Mark size={48} />
        {busy ? (
          <h2>Signing you in…</h2>
        ) : phantomSign && (
          <>
            <h2>Connected {phantomSign.address.slice(0, 4)}…{phantomSign.address.slice(-4)}</h2>
            <p>One more step: sign a free message in Phantom to log in. No transaction, no fees.</p>
          </>
        )}
      </div>
      {!busy && phantomSign && <button className="btn btn-lg wide" disabled={!phantomSign.ready} onClick={continuePhantomSign}>{phantomSign.ready ? "Sign in with Phantom" : "Preparing…"}</button>}
      {error && <p className="err">{error}</p>}
    </Sheet>
  );
}
