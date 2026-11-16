"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  KeyRound,
  Power,
  Search,
  UserRound,
  X,
} from "lucide-react";

type RoleOption = { key: string; name: string };
type PermissionOption = { key: string; description: string };
type UserRow = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  activatedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  roles: { role: RoleOption }[];
  permissions: string[];
};

const pageSize = 10;
const EMPTY_FORM = { fullName: "", email: "", roleKey: "REQUESTOR", password: "", permissions: [] as string[] };

export function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<PermissionOption[]>([]);
  const [canManagePermissions, setCanManagePermissions] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<UserRow | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<string[]>([]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status, search, role: roleFilter });
    try {
      const response = await fetch(`/api/users?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load users.");
      setUsers(result.users);
      setRoles(result.roles);
      setAvailablePermissions(result.availablePermissions ?? []);
      setCanManagePermissions(Boolean(result.canManagePermissions));
      setCurrentUserId(result.currentUserId);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadUsers(); }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers, search]);

  async function updateUser(id: string, url: string, body: object, success: string) {
    setNotice("");
    setError("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update user.");
      setNotice(success);
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update user.");
    }
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to create the employee.");
      setNotice(result.message);
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the employee.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
  }

  async function savePermissions() {
    if (!permissionsFor) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${permissionsFor.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: permissionDraft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update permissions.");
      setNotice(`${permissionsFor.fullName}'s access updated.`);
      setPermissionsFor(null);
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update permissions.");
    } finally {
      setBusy(false);
    }
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="user-toolbar">
        <div className="user-filters">
          <div className="search-field">
            <Search size={17} />
            <input aria-label="Search users" placeholder="Search name or email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            {search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={15} /></button>}
          </div>
          <select aria-label="Filter by status" className="select-input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
          <select aria-label="Filter by role" className="select-input" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {roles.map((role) => <option value={role.key} key={role.key}>{role.name}</option>)}
          </select>
        </div>
        <button className="button button-primary" onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); setNotice(""); }}>
          <CirclePlus size={17} /> Create employee
        </button>
      </div>

      {error && <div className="inline-alert inline-alert-error" role="alert">{error}<button onClick={() => setError("")}><X size={16} /></button></div>}
      {notice && <div className="inline-alert inline-alert-success" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}

      <section className="panel users-table-panel">
        <div className="table-responsive">
          <table className="users-table">
            <thead>
              <tr><th>EMPLOYEE</th><th>ROLE</th><th>ACCOUNT STATUS</th><th>CREATED</th><th>LAST LOGIN</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="table-empty" colSpan={6}>Loading user accounts...</td></tr>
              ) : users.length === 0 ? (
                <tr><td className="table-empty" colSpan={6}><span className="empty-icon"><UserRound size={21} /></span><strong>No users found</strong><span>Try adjusting your search or filters.</span></td></tr>
              ) : users.map((user) => {
                const accountStatus = user.isActive ? "Active" : "Deactivated";
                const role = user.roles[0]?.role;
                return (
                  <tr key={user.id}>
                    <td><div className="employee-cell"><span className="employee-avatar">{user.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span><strong>{user.fullName}</strong><small>{user.email}</small>{user.permissions.length > 0 && <small className="employee-perms">{user.permissions.join(" · ")}</small>}</span></div></td>
                    <td>
                      <select
                        aria-label={`Role for ${user.fullName}`}
                        className="role-select"
                        disabled={user.id === currentUserId}
                        value={role?.key ?? ""}
                        onChange={(event) => void updateUser(user.id, `/api/users/${user.id}/role`, { roleKey: event.target.value }, `${user.fullName}'s role updated.`)}
                      >
                        {!role && <option value="">No role</option>}
                        {roles.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}
                      </select>
                    </td>
                    <td><span className={`status-pill status-${accountStatus === "Active" ? "active" : "inactive"}`}><span />{accountStatus}</span></td>
                    <td className="date-cell">{formatDate(user.createdAt)}</td>
                    <td className="date-cell">{user.lastLoginAt ? formatDate(user.lastLoginAt) : <span className="muted-value">—</span>}</td>
                    <td className="row-action-cell">
                      {canManagePermissions && (
                        <button
                          className="row-action"
                          aria-label={`Manage access for ${user.fullName}`}
                          title="Manage additional access"
                          disabled={user.id === currentUserId}
                          onClick={() => { setPermissionsFor(user); setPermissionDraft(user.permissions); }}
                        >
                          <KeyRound size={16} />
                        </button>
                      )}
                      <button
                        className="row-action"
                        aria-label={`${user.isActive ? "Deactivate" : "Activate"} ${user.fullName}`}
                        title={user.isActive ? "Deactivate account" : "Activate account"}
                        disabled={user.id === currentUserId}
                        onClick={() => void updateUser(user.id, `/api/users/${user.id}/status`, { isActive: !user.isActive }, `${user.fullName}'s account ${user.isActive ? "deactivated" : "activated"}.`)}
                      >
                        <Power size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> employees</span>
          <div className="pagination">
            <button aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button>
            <span>Page <strong>{page}</strong> of <strong>{pages}</strong></span>
            <button aria-label="Next page" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button>
          </div>
        </div>
      </section>

      {createOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
          <section aria-labelledby="create-title" aria-modal="true" className="modal-panel" role="dialog">
            <div className="modal-heading">
              <div><span className="eyebrow">TEAM ACCESS</span><h2 id="create-title">Create an employee</h2><p>The account is active immediately and can sign in with the password you set.</p></div>
              <button className="icon-button" aria-label="Close create dialog" onClick={() => setCreateOpen(false)}><X size={19} /></button>
            </div>
            <form className="invite-form" onSubmit={createEmployee}>
              <label className="field-label" htmlFor="create-name">Employee name</label>
              <input autoFocus className="text-input" id="create-name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Full name" required minLength={2} maxLength={120} />
              <label className="field-label" htmlFor="create-email">JSAN work email</label>
              <input className="text-input" id="create-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@jsanconsulting.com" required />
              <label className="field-label" htmlFor="create-role">Assigned role</label>
              <select className="text-input" id="create-role" value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })}>
                {roles.map((role) => <option value={role.key} key={role.key}>{role.name}</option>)}
              </select>
              <label className="field-label" htmlFor="create-password">Initial password</label>
              <input className="text-input" id="create-password" type="text" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 12 characters" required />
              <p className="field-hint">Must include uppercase, lowercase, a number, and a symbol. Share it securely; the employee can change it later.</p>
              {canManagePermissions && availablePermissions.length > 0 && (
                <>
                  <label className="field-label">Additional access (optional)</label>
                  <div className="permission-toggle-grid">
                    {availablePermissions.map((permission) => (
                      <label className="permission-toggle" key={permission.key}>
                        <input type="checkbox" checked={form.permissions.includes(permission.key)} onChange={() => setForm({ ...form, permissions: toggle(form.permissions, permission.key) })} />
                        <span><strong>{permission.key}</strong><small>{permission.description}</small></span>
                      </label>
                    ))}
                  </div>
                </>
              )}
              <div className="modal-actions">
                <button className="button button-secondary" type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button className="button button-primary" disabled={busy} type="submit">{busy ? "Creating..." : "Create employee"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {permissionsFor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPermissionsFor(null); }}>
          <section aria-labelledby="perm-title" aria-modal="true" className="modal-panel" role="dialog">
            <div className="modal-heading">
              <div><span className="eyebrow">ADDITIONAL ACCESS</span><h2 id="perm-title">Manage access</h2><p>{permissionsFor.fullName} · {permissionsFor.email}</p></div>
              <button className="icon-button" aria-label="Close access dialog" onClick={() => setPermissionsFor(null)}><X size={19} /></button>
            </div>
            <div className="invite-form">
              <div className="permission-toggle-grid">
                {availablePermissions.map((permission) => (
                  <label className="permission-toggle" key={permission.key}>
                    <input type="checkbox" checked={permissionDraft.includes(permission.key)} onChange={() => setPermissionDraft(toggle(permissionDraft, permission.key))} />
                    <span><strong>{permission.key}</strong><small>{permission.description}</small></span>
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button className="button button-secondary" type="button" onClick={() => setPermissionsFor(null)}>Cancel</button>
                <button className="button button-primary" disabled={busy} type="button" onClick={() => void savePermissions()}>{busy ? "Saving..." : "Save access"}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
