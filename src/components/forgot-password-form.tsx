"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setDevelopmentUrl("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to process the request.");
      setMessage(result.message);
      if (result.developmentUrl) setDevelopmentUrl(result.developmentUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to process the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field-label" htmlFor="email">JSAN work email</label>
      <div className="input-wrap">
        <Mail size={17} aria-hidden="true" />
        <input
          autoComplete="email"
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      {error && <p className="form-message form-message-error" role="alert">{error}</p>}
      {message && <p className="form-message form-message-success" role="status">{message}</p>}
      {developmentUrl && (
        <div className="dev-link-panel">
          <span>Development reset link</span>
          <a href={developmentUrl}>{developmentUrl}</a>
        </div>
      )}
      <button className="button button-primary auth-submit" disabled={busy} type="submit">
        {busy ? "Sending..." : "Send reset link"}
        {!busy && <ArrowRight size={17} />}
      </button>
      <Link className="back-link" href="/">Back to sign in</Link>
    </form>
  );
}
