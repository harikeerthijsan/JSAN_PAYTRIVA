"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, KeyRound, LockKeyhole } from "lucide-react";

export function ActivationForm({
  reset = false,
}: {
  reset?: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (!token) {
      setError("This link is missing its security token.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(reset ? "/api/auth/reset-password" : "/api/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update your password.");
      window.history.replaceState(null, "", window.location.pathname);
      if (reset) {
        setDone(true);
      } else {
        router.replace("/dashboard");
        router.refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update your password.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="success-panel">
        <span className="success-check">✓</span>
        <strong>Password updated</strong>
        <p>Your password has been changed. Sign in with your new password to continue.</p>
        <Link className="button button-primary" href="/">Return to sign in <ArrowRight size={17} /></Link>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field-label" htmlFor="new-password">New password</label>
      <div className="input-wrap">
        <KeyRound size={17} aria-hidden="true" />
        <input
          autoComplete="new-password"
          id="new-password"
          minLength={12}
          maxLength={72}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <label className="field-label" htmlFor="confirm-password">Confirm password</label>
      <div className="input-wrap">
        <LockKeyhole size={17} aria-hidden="true" />
        <input
          autoComplete="new-password"
          id="confirm-password"
          minLength={12}
          maxLength={72}
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </div>
      <p className="password-hint">At least 12 characters with uppercase, lowercase, a number, and a symbol; maximum 72 UTF-8 bytes.</p>
      {error && <p className="form-message form-message-error" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" disabled={busy} type="submit">
        {busy ? "Saving..." : reset ? "Reset password" : "Activate account"}
        {!busy && <ArrowRight size={17} />}
      </button>
    </form>
  );
}
