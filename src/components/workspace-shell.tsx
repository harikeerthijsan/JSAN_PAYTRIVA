"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";

type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  timeZone: string;
  roles: { key: string; name: string }[];
  permissions: string[];
};

export function WorkspaceShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; title: string; message: string; href: string | null; createdAt: string; readAt: string | null }[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationError, setNotificationError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const dashboardMode = pathname === "/dashboard";
  const roleLabel = user.roles[0]?.name ?? "Team member";
  const initials = user.fullName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const navigation = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    ...(user.permissions.includes("payments:read_own") || user.permissions.includes("payments:read_all")
      ? [{ href: "/payment-requests", label: "Payment requests", icon: FileCheck2 }]
      : []),
    ...(user.permissions.includes("payments:read_own") || user.permissions.includes("payments:read_all") || user.permissions.includes("approvals:access")
      ? [{ href: "/workspace/calendar", label: "Payment calendar", icon: CalendarDays }]
      : []),
    ...(user.permissions.includes("reports:access")
      ? [{ href: "/workspace/management", label: "Management", icon: BarChart3 }]
      : []),
    ...(user.permissions.includes("users:read")
      ? [{ href: "/users", label: "User management", icon: Users }]
      : []),
    ...(user.permissions.includes("ap:access")
      ? [{ href: "/workspace/payables", label: "AP workspace", icon: Building2 }]
      : []),
    ...(user.permissions.includes("approvals:access")
      ? [{ href: "/workspace/approvals", label: "Approvals", icon: FileCheck2 }]
      : []),
    ...(user.permissions.includes("platform:admin")
      ? [{ href: "/admin/audit", label: "Audit log", icon: ScrollText }]
      : []),
    ...(user.permissions.includes("platform:admin")
      ? [{ href: "/admin/notifications", label: "Notification settings", icon: Bell }]
      : []),
    ...(user.permissions.includes("payments:manage_masters")
      ? [{ href: "/payment-masters", label: "Payment settings", icon: Settings2 }]
      : []),
    ...(user.permissions.includes("payments:manage_masters")
      ? [{ href: "/admin/approval-matrix", label: "Approval matrix", icon: ShieldCheck }]
      : []),
  ];

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load notifications.");
      setNotifications(result.items);
      setUnreadNotifications(result.unread);
      setNotificationError("");
    } catch (reason) {
      setNotificationError(reason instanceof Error ? reason.message : "Unable to load notifications.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadNotifications(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadNotifications]);

  async function markNotificationRead(id?: string) {
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to mark notifications as read.");
      await loadNotifications();
    } catch (reason) {
      setNotificationError(reason instanceof Error ? reason.message : "Unable to mark notifications as read.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <div className={`workspace${dashboardMode ? " workspace-dashboard" : ""}`}>
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand compact />
          <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={19} /></button>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-section-label">WORKSPACE</span>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link${pathname === href ? " nav-link-active" : ""}`}
              aria-label={label}
              title={label}
              data-label={label}
              href={href}
              key={href}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {pathname === href && <span className="active-indicator" />}
            </Link>
          ))}
          <span className="nav-section-label nav-section-spaced">ACCOUNT</span>
          <Link className={`nav-link${pathname === "/profile" ? " nav-link-active" : ""}`} aria-label="My profile" title="My profile" data-label="My profile" href="/profile" onClick={() => setMobileOpen(false)}>
            <Settings2 size={18} strokeWidth={1.8} /><span>My profile</span>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <button className="help-link" type="button" aria-expanded={supportOpen} onClick={() => setSupportOpen(!supportOpen)}>
            <CircleHelp size={17} /><span>Help &amp; support</span><ArrowUpRight size={14} className="help-external" />
          </button>
          {supportOpen && <p className="sidebar-support-note">For help with your profile or role, contact your JSAN administrator.</p>}
          <div className="sidebar-version">PAYTRIVA <span>•</span> JSAN FINANCE</div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="workspace-topbar-brand"><Brand compact /></div>
          {!dashboardMode && <div className="breadcrumbs"><span>JSAN Consulting</span><span className="breadcrumb-slash">/</span><strong>{pageTitle(pathname)}</strong></div>}
          {user.permissions.includes("payments:read_own") || user.permissions.includes("payments:read_all") ? (
            <form
              className="workspace-global-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const query = globalSearch.trim();
                router.push(query ? `/payment-requests?search=${encodeURIComponent(query)}` : "/payment-requests");
              }}
            >
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Search payment requests"
                placeholder="Search requests, vendors, invoices..."
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
              />
              <kbd>Enter</kbd>
            </form>
          ) : <span className="workspace-topbar-spacer" />}
          <div className="topbar-actions">
            <div className="popover-anchor">
              <button
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                className={`icon-button notification-button${notificationsOpen ? " icon-button-selected" : ""}`}
                onClick={() => { setNotificationsOpen(!notificationsOpen); setProfileOpen(false); void loadNotifications(); }}
              >
                <Bell size={18} strokeWidth={1.8} />{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>}
              </button>
              {notificationsOpen && (
                <div className="popover notification-popover">
                  <div className="notification-heading"><strong>Notifications</strong>{unreadNotifications > 0 && <button onClick={() => void markNotificationRead()}>Mark all read</button>}</div>
                  {notificationError && <p className="notification-error" role="alert">{notificationError}</p>}
                  {!notificationError && !notifications.length && <p>You&apos;re all caught up. Updates will appear here.</p>}
                  <div className="notification-items">{notifications.map((notification) => notification.href
                    ? <Link key={notification.id} href={notification.href} className={notification.readAt ? "" : "notification-unread"} onClick={() => void markNotificationRead(notification.id)}>
                      <strong>{notification.title}</strong><span>{notification.message}</span>                      <small>{new Date(notification.createdAt).toLocaleString(undefined, { timeZone: user.timeZone })}</small>
                    </Link>
                    : <div key={notification.id} className={notification.readAt ? "" : "notification-unread"}><strong>{notification.title}</strong><span>{notification.message}</span></div>)}</div>
                  <Link className="notification-view-all" href="/notifications" onClick={() => setNotificationsOpen(false)}>View notification history</Link>
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <div className="popover-anchor">
              <button className="profile-trigger" onClick={() => { setProfileOpen(!profileOpen); setNotificationsOpen(false); }} aria-expanded={profileOpen}>
                <span className="avatar">{initials}</span>
                <span className="profile-trigger-copy"><strong>{user.fullName}</strong><small>{roleLabel}</small></span>
                <ChevronDown size={15} className="profile-chevron" />
              </button>
              {profileOpen && (
                <div className="popover profile-popover">
                  <div className="popover-user"><strong>{user.fullName}</strong><small>{user.email}</small></div>
                  <Link href="/profile" onClick={() => setProfileOpen(false)}><Settings2 size={16} /> My profile</Link>
                  <button onClick={logout}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/notifications")) return "Notifications";
  if (pathname.startsWith("/users")) return "User management";
  if (pathname.startsWith("/payment-requests")) return "Payment requests";
  if (pathname.startsWith("/payment-masters")) return "Payment settings";
  if (pathname.startsWith("/workspace/calendar")) return "Payment calendar";
  if (pathname.startsWith("/workspace/management")) return "Management dashboard";
  if (pathname.startsWith("/workspace/payables")) return "AP workspace";
  if (pathname.startsWith("/workspace/approvals")) return "Approvals";
  if (pathname.startsWith("/admin/approval-matrix")) return "Approval matrix";
  if (pathname.startsWith("/admin/notifications")) return "Notification settings";
  if (pathname === "/profile") return "My profile";
  return "Overview";
}
