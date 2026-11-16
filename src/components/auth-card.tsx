import type { ReactNode } from "react";
import Image from "next/image";
import { Brand } from "@/components/brand";

export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  variant,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  variant?: "login";
}) {
  const isLogin = variant === "login";
  const loginAside = (
    <aside className="auth-aside auth-aside-login">
      <div className="login-brand-lockup"><Brand /></div>
      <div className="login-visual">
        <Image
          alt="Illustration of the JSAN office with invoice, review, approval, and payment symbols"
          height={780}
          priority
          src="/login-financial-illustration.svg"
          width={1100}
        />
      </div>
    </aside>
  );

  const panel = (
    <section className={`auth-panel${isLogin ? " auth-panel-login" : ""}`}>
      {isLogin ? (
        <>
          <div className="login-panel-heading">
            <span>Welcome to</span>
            <h1>PAYTRIVA</h1>
            <p>JSAN Consulting&apos;s Invoice-to-Payment Platform</p>
          </div>
        </>
      ) : (
        <>
          <Brand />
          <div className="auth-intro">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </>
      )}
      {children}
      <div className={`auth-footer${isLogin ? " login-auth-footer" : ""}`}>
        <span>Secure financial control</span>
        <span className="footer-dot" />
        <span>JSAN Enterprise</span>
      </div>
    </section>
  );

  return (
    <main className={`auth-page${isLogin ? " auth-page-login" : ""}`}>
      <div className="auth-orbit auth-orbit-one" />
      <div className="auth-orbit auth-orbit-two" />
      {isLogin ? (
        <>
          {loginAside}
          {panel}
        </>
      ) : (
        <>
          {panel}
          <aside className="auth-aside">
            <div className="aside-glow" />
            <div className="aside-content">
              <div className="aside-kicker"><span /> FINANCIAL CONTROL, CONNECTED</div>
              <h2>Clarity and control for every financial decision.</h2>
              <p>
                A considered workspace for JSAN teams to manage access, work with
                confidence, and keep every decision accountable.
              </p>
              <div className="aside-rule" />
              <div className="aside-caption">
                <span className="caption-mark">J</span>
                <span><strong>Built for JSAN</strong><small>One platform. Clear accountability.</small></span>
              </div>
            </div>
            <span className="aside-index">01 — CONTROL WITH CONFIDENCE</span>
          </aside>
        </>
      )}
    </main>
  );
}
