"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to sign in.");
      router.replace("/dashboard");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="email">Work email</label>
      <div className="input-wrap login-input-wrap">
        <Mail size={17} aria-hidden="true" />
        <input
          autoComplete="username"
          id="email"
          name="email"
          type="email"
          placeholder="Enter your work email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <label className="sr-only" htmlFor="password">Password</label>
      <div className="input-wrap login-input-wrap">
        <LockKeyhole size={17} aria-hidden="true" />
        <input
          autoComplete="current-password"
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="input-action"
          onClick={() => setShowPassword(!showPassword)}
          type="button"
        >
          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      <div className="login-options">
        <label className="remember-option">
          <input
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            name="rememberMe"
            type="checkbox"
          />
          <span>Remember me</span>
        </label>
        <Link className="text-link" href="/forgot-password">Forgot password?</Link>
      </div>
      {error && <p className="form-message form-message-error" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" disabled={busy} type="submit">
        {busy ? "Signing in..." : "Sign in"}
        {!busy && <ArrowRight size={17} />}
      </button>
      <p className="auth-helper">Access is provided by invitation from your JSAN administrator.</p>
    </form>
  );
}
