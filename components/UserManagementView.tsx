"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  type AdminUsersResponse,
  type AssignableOperatorRole,
  type CreateOperatorRequest,
  type OperatorRole,
  type OperatorSession,
  type OperatorUser,
  type OperatorUserResponse,
  type PasswordResetOperatorRequest,
  type UpdateOperatorRequest,
} from "@/lib/operator-types";

type NoticeTone = "success" | "error";

export type UserManagementViewProps = {
  user: User;
  currentOperator: OperatorSession;
  bootstrapOwnerEmail?: string;
  onNotice?: (message: string, tone: NoticeTone) => void;
};

type OperatorDraft = {
  displayName: string;
  role: OperatorRole;
};

type RequestState = "idle" | "loading" | "ready" | "error";

const assignableRoles: AssignableOperatorRole[] = ["operator", "viewer"];

function normalizedEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isAssignableRole(role: OperatorRole): role is AssignableOperatorRole {
  return role === "operator" || role === "viewer";
}

function roleLabel(role: OperatorRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "operator":
      return "Operator";
    default:
      return "Viewer";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function isOperatorUser(value: unknown): value is OperatorUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OperatorUser>;
  return (
    typeof candidate.uid === "string" &&
    typeof candidate.email === "string" &&
    (candidate.displayName === null || typeof candidate.displayName === "string") &&
    (candidate.role === "owner" || candidate.role === "operator" || candidate.role === "viewer") &&
    typeof candidate.disabled === "boolean" &&
    typeof candidate.emailVerified === "boolean" &&
    (candidate.createdAt === null || typeof candidate.createdAt === "string") &&
    (candidate.lastSignInAt === null || typeof candidate.lastSignInAt === "string")
  );
}

function parseUsersResponse(value: unknown): OperatorUser[] {
  const candidate = value as Partial<AdminUsersResponse> | null;
  if (!candidate || !Array.isArray(candidate.users) || !candidate.users.every(isOperatorUser)) {
    throw new Error("The authorization service returned an invalid user directory.");
  }
  return candidate.users;
}

function parseUserResponse(value: unknown): OperatorUser {
  const candidate = value as Partial<OperatorUserResponse> | null;
  if (!candidate || !isOperatorUser(candidate.user)) {
    throw new Error("The authorization service returned an invalid operator record.");
  }
  return candidate.user;
}

async function responseError(response: Response): Promise<string> {
  let code = "";
  try {
    const payload = (await response.json()) as { error?: unknown };
    code = typeof payload.error === "string" ? payload.error : "";
  } catch {
    // Some failures intentionally have no JSON body.
  }

  switch (code) {
    case "owner_required":
    case "operator_not_authorized":
      return "Owner authorization is required for this operation.";
    case "operator_not_found":
      return "That operator account no longer exists. Refresh the directory.";
    case "email_in_use":
    case "operator_email_exists":
    case "auth/email-already-exists":
      return "An account already uses that email address.";
    case "weak_password":
    case "auth/invalid-password":
      return "Use an initial or replacement password with at least 12 characters.";
    case "protected_owner":
    case "protected_owner_account":
    case "owner_protected":
      return "The protected owner account cannot be disabled, demoted, or removed.";
    case "invalid_request":
    case "invalid_operator_details":
      return "Review the operator details and try again.";
    default:
      if (response.status === 401) return "Your secure session expired. Sign in again.";
      if (response.status === 403) return "Owner authorization is required for this operation.";
      if (response.status === 429) return "Too many requests were made. Wait a moment and try again.";
      return "The user-management service could not complete the operation.";
  }
}

async function adminRequest(
  user: User,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  async function execute(forceRefresh: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await user.getIdToken(forceRefresh)}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");

    return fetch(path, {
      ...init,
      headers,
      cache: "no-store",
    });
  }

  let response = await execute(false);
  if (response.status === 401) response = await execute(true);
  return response;
}

function sortedOperators(users: OperatorUser[]): OperatorUser[] {
  return [...users].sort((left, right) => {
    if (left.role === "owner" && right.role !== "owner") return -1;
    if (right.role === "owner" && left.role !== "owner") return 1;
    const leftName = left.displayName?.trim() || left.email;
    const rightName = right.displayName?.trim() || right.email;
    return leftName.localeCompare(rightName);
  });
}

export function UserManagementView({
  user,
  currentOperator,
  bootstrapOwnerEmail,
  onNotice,
}: UserManagementViewProps) {
  const [operators, setOperators] = useState<OperatorUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, OperatorDraft>>({});
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [announcementTone, setAnnouncementTone] = useState<NoticeTone>("success");

  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<AssignableOperatorRole>("operator");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [passwordTarget, setPasswordTarget] = useState<OperatorUser | null>(null);
  const [replacementPassword, setReplacementPassword] = useState("");
  const [showReplacementPassword, setShowReplacementPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OperatorUser | null>(null);

  const passwordDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  const bootstrapEmail = normalizedEmail(bootstrapOwnerEmail);

  const announce = useCallback((message: string, tone: NoticeTone = "success") => {
    setAnnouncement(message);
    setAnnouncementTone(tone);
    onNotice?.(message, tone);
  }, [onNotice]);

  const mergeOperator = useCallback((nextOperator: OperatorUser) => {
    setOperators((current) => sortedOperators([
      ...current.filter((operator) => operator.uid !== nextOperator.uid),
      nextOperator,
    ]));
    setDrafts((current) => ({
      ...current,
      [nextOperator.uid]: {
        displayName: nextOperator.displayName ?? "",
        role: nextOperator.role,
      },
    }));
  }, []);

  const loadOperators = useCallback(async () => {
    setRequestState("loading");
    setBusyKey("load");
    try {
      const response = await adminRequest(user, "/api/admin/users");
      if (!response.ok) throw new Error(await responseError(response));
      const nextOperators = sortedOperators(parseUsersResponse(await response.json()));
      setOperators(nextOperators);
      setDrafts(Object.fromEntries(nextOperators.map((operator) => [
        operator.uid,
        { displayName: operator.displayName ?? "", role: operator.role },
      ])));
      setRequestState("ready");
    } catch (error) {
      setRequestState("error");
      announce(error instanceof Error ? error.message : "Unable to load authorized operators.", "error");
    } finally {
      setBusyKey(null);
    }
  }, [announce, user]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadOperators(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadOperators]);

  useEffect(() => {
    const dialog = passwordDialogRef.current;
    if (!dialog) return;
    if (passwordTarget && !dialog.open) dialog.showModal();
    if (!passwordTarget && dialog.open) dialog.close();
  }, [passwordTarget]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (deleteTarget && !dialog.open) dialog.showModal();
    if (!deleteTarget && dialog.open) dialog.close();
  }, [deleteTarget]);

  const summary = useMemo(() => ({
    total: operators.length,
    active: operators.filter((operator) => !operator.disabled).length,
    privileged: operators.filter((operator) => operator.role === "owner" || operator.role === "operator").length,
  }), [operators]);

  function isProtected(operator: OperatorUser): boolean {
    return (
      operator.role === "owner" ||
      operator.uid === currentOperator.uid ||
      (bootstrapEmail !== "" && normalizedEmail(operator.email) === bootstrapEmail)
    );
  }

  function resetCreateForm() {
    setNewEmail("");
    setNewDisplayName("");
    setNewRole("operator");
    setNewPassword("");
    setShowNewPassword(false);
  }

  async function createOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();
    const displayName = newDisplayName.trim();

    if (!email || newPassword.length < 12) {
      announce("Enter a valid email and an initial password of at least 12 characters.", "error");
      return;
    }

    const payload: CreateOperatorRequest = {
      email,
      role: newRole,
      temporaryPassword: newPassword,
      ...(displayName ? { displayName } : {}),
    };

    setBusyKey("create");
    try {
      const response = await adminRequest(user, "/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const created = parseUserResponse(await response.json());
      mergeOperator(created);
      resetCreateForm();
      announce(`${created.email} was authorized as ${roleLabel(created.role).toLowerCase()}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Unable to create the operator account.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  function updateDraft(uid: string, update: Partial<OperatorDraft>) {
    setDrafts((current) => ({
      ...current,
      [uid]: {
        displayName: current[uid]?.displayName ?? "",
        role: current[uid]?.role ?? "viewer",
        ...update,
      },
    }));
  }

  async function saveOperator(operator: OperatorUser) {
    const draft = drafts[operator.uid];
    if (!draft) return;

    const payload: UpdateOperatorRequest = {};
    const nextName = draft.displayName.trim();
    if (nextName !== (operator.displayName ?? "") && !nextName) {
      announce("Display name cannot be blank.", "error");
      return;
    }
    if (nextName !== (operator.displayName ?? "")) payload.displayName = nextName;
    if (
      !isProtected(operator) &&
      draft.role !== operator.role &&
      isAssignableRole(draft.role)
    ) {
      payload.role = draft.role;
    }

    if (Object.keys(payload).length === 0) {
      announce(`No changes are pending for ${operator.email}.`);
      return;
    }

    setBusyKey(`${operator.uid}:save`);
    try {
      const response = await adminRequest(
        user,
        `/api/admin/users/${encodeURIComponent(operator.uid)}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const updated = parseUserResponse(await response.json());
      mergeOperator(updated);
      announce(`${updated.email} was updated.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Unable to update the operator.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleDisabled(operator: OperatorUser) {
    if (isProtected(operator)) {
      announce("The protected owner account cannot be disabled.", "error");
      return;
    }

    const nextDisabled = !operator.disabled;
    setBusyKey(`${operator.uid}:status`);
    try {
      const payload: UpdateOperatorRequest = { disabled: nextDisabled };
      const response = await adminRequest(
        user,
        `/api/admin/users/${encodeURIComponent(operator.uid)}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const updated = parseUserResponse(await response.json());
      mergeOperator(updated);
      announce(`${updated.email} was ${updated.disabled ? "disabled" : "enabled"}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Unable to change the account status.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function sendPasswordReset(operator: OperatorUser) {
    setBusyKey(`${operator.uid}:reset`);
    try {
      const payload: PasswordResetOperatorRequest = { action: "send_password_reset" };
      const response = await adminRequest(
        user,
        `/api/admin/users/${encodeURIComponent(operator.uid)}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      if (!response.ok) throw new Error(await responseError(response));
      announce(`Password-reset instructions were sent to ${operator.email}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Unable to send the password reset.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function setTemporaryPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordTarget) return;
    if (replacementPassword.length < 12) {
      announce("Use a replacement password with at least 12 characters.", "error");
      return;
    }

    setBusyKey(`${passwordTarget.uid}:password`);
    try {
      const payload: UpdateOperatorRequest = { temporaryPassword: replacementPassword };
      const response = await adminRequest(
        user,
        `/api/admin/users/${encodeURIComponent(passwordTarget.uid)}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const updated = parseUserResponse(await response.json());
      mergeOperator(updated);
      const email = passwordTarget.email;
      setReplacementPassword("");
      setShowReplacementPassword(false);
      setPasswordTarget(null);
      announce(`A replacement password was set for ${email}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Unable to set the temporary password.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget) return;
    if (isProtected(deleteTarget)) {
      announce("The protected owner account cannot be removed.", "error");
      setDeleteTarget(null);
      return;
    }

    setBusyKey(`${deleteTarget.uid}:delete`);
    try {
      const response = await adminRequest(
        user,
        `/api/admin/users/${encodeURIComponent(deleteTarget.uid)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const email = deleteTarget.email;
      setOperators((current) => current.filter((operator) => operator.uid !== deleteTarget.uid));
      setDrafts((current) => {
        const next = { ...current };
        delete next[deleteTarget.uid];
        return next;
      });
      setDeleteTarget(null);
      announce(`${email} was removed from Dover Controls.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Unable to remove the operator.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  const globallyBusy = busyKey !== null;

  return (
    <div className="dashboard-content user-management">
      <section className="panel detail-intro user-management__intro" aria-labelledby="user-management-title">
        <div className="detail-code" aria-hidden="true">US</div>
        <div>
          <span className="section-kicker">Access administration</span>
          <h2 id="user-management-title">Users and permissions</h2>
          <p>Create authorized identities, assign control access, secure passwords, and immediately suspend or remove accounts.</p>
        </div>
        <span className="state-badge state-badge--ready">Owner control</span>
      </section>

      <div className="user-management__summary" aria-label="Operator directory summary">
        <section className="panel user-summary-card">
          <span>Authorized identities</span>
          <strong>{summary.total}</strong>
          <small>All registered Dover Controls users</small>
        </section>
        <section className="panel user-summary-card">
          <span>Active accounts</span>
          <strong>{summary.active}</strong>
          <small>Currently permitted to sign in</small>
        </section>
        <section className="panel user-summary-card">
          <span>Control operators</span>
          <strong>{summary.privileged}</strong>
          <small>Owner and operator roles</small>
        </section>
      </div>

      <section className="panel user-management__create" aria-labelledby="add-operator-title">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Provision identity</span>
            <h3 id="add-operator-title">Add an authorized user</h3>
          </div>
          <span className="state-badge state-badge--sample">Owner only</span>
        </div>

        <form className="operator-create-form" onSubmit={createOperator}>
          <label className="operator-field">
            <span>Email address</span>
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              autoComplete="email"
              placeholder="operator@example.com"
              disabled={globallyBusy}
              required
            />
          </label>
          <label className="operator-field">
            <span>Display name</span>
            <input
              type="text"
              value={newDisplayName}
              onChange={(event) => setNewDisplayName(event.target.value)}
              autoComplete="name"
              placeholder="Authorized operator"
              disabled={globallyBusy}
              maxLength={80}
            />
          </label>
          <label className="operator-field">
            <span>Access role</span>
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as AssignableOperatorRole)}
              disabled={globallyBusy}
            >
              {assignableRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
          </label>
          <label className="operator-field operator-field--password">
            <span>Initial password</span>
            <span className="operator-password-control">
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 12 characters"
                disabled={globallyBusy}
                minLength={12}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="operator-password-toggle"
                onClick={() => setShowNewPassword((visible) => !visible)}
                disabled={globallyBusy}
                aria-label={showNewPassword ? "Hide initial password" : "Show initial password"}
              >
                {showNewPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          <div className="operator-create-form__actions">
            <button className="primary-button primary-button--compact" type="submit" disabled={globallyBusy}>
              {busyKey === "create" ? "Creating…" : "Authorize user"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel user-management__directory" aria-labelledby="operator-directory-title">
        <div className="panel-heading operator-directory-heading">
          <div>
            <span className="section-kicker">Identity registry</span>
            <h3 id="operator-directory-title">Authorized operators</h3>
          </div>
          <button
            type="button"
            className="account-secondary-button"
            onClick={() => void loadOperators()}
            disabled={globallyBusy}
          >
            {busyKey === "load" ? "Refreshing…" : "Refresh directory"}
          </button>
        </div>

        <p
          className={`form-message form-message--${announcementTone} user-management__announcement`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>

        {requestState === "loading" && operators.length === 0 && (
          <div className="operator-directory-state" role="status">Loading the protected operator directory…</div>
        )}
        {requestState === "error" && operators.length === 0 && (
          <div className="operator-directory-state operator-directory-state--error">The directory is unavailable. Use Refresh directory to try again.</div>
        )}
        {requestState === "ready" && operators.length === 0 && (
          <div className="operator-directory-state">No authorized operators were returned.</div>
        )}

        <div className="operator-list">
          {operators.map((operator) => {
            const protectedOperator = isProtected(operator);
            const draft = drafts[operator.uid] ?? {
              displayName: operator.displayName ?? "",
              role: operator.role,
            };
            const roleChanged = draft.role !== operator.role;
            const nameChanged = draft.displayName.trim() !== (operator.displayName ?? "");

            return (
              <article
                className={`operator-row ${operator.disabled ? "operator-row--disabled" : ""}`}
                key={operator.uid}
                aria-labelledby={`operator-${operator.uid}-name`}
              >
                <header className="operator-row__identity">
                  <span className="operator-avatar" aria-hidden="true">
                    {(operator.displayName?.trim() || operator.email).slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong id={`operator-${operator.uid}-name`}>{operator.displayName?.trim() || "Unnamed operator"}</strong>
                    <span>{operator.email}</span>
                  </div>
                  <span className={`state-badge ${operator.disabled ? "" : "state-badge--ready"}`}>
                    {operator.disabled ? "Disabled" : "Active"}
                  </span>
                </header>

                <div className="operator-row__metadata">
                  <span><b>Created</b>{formatDate(operator.createdAt)}</span>
                  <span><b>Last sign-in</b>{formatDate(operator.lastSignInAt)}</span>
                  <span><b>Email</b>{operator.emailVerified ? "Verified" : "Unverified"}</span>
                  {protectedOperator && <span className="operator-protection-note"><b>Protection</b>Owner safeguards active</span>}
                </div>

                <div className="operator-row__editor">
                  <label className="operator-field">
                    <span>Display name</span>
                    <input
                      type="text"
                      value={draft.displayName}
                      onChange={(event) => updateDraft(operator.uid, { displayName: event.target.value })}
                      disabled={globallyBusy}
                      maxLength={80}
                    />
                  </label>
                  <label className="operator-field">
                    <span>Role</span>
                    <select
                      value={draft.role}
                      onChange={(event) => updateDraft(operator.uid, { role: event.target.value as OperatorRole })}
                      disabled={globallyBusy || protectedOperator}
                      aria-describedby={protectedOperator ? `operator-${operator.uid}-role-note` : undefined}
                    >
                      {operator.role === "owner" && <option value="owner">Owner</option>}
                      {assignableRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    </select>
                  </label>
                  {protectedOperator && (
                    <small id={`operator-${operator.uid}-role-note`} className="operator-role-note">
                      The owner role cannot be changed here.
                    </small>
                  )}
                  <button
                    type="button"
                    className="account-secondary-button"
                    onClick={() => void saveOperator(operator)}
                    disabled={globallyBusy || (!nameChanged && (!roleChanged || protectedOperator))}
                    aria-label={`Save profile changes for ${operator.email}`}
                  >
                    {busyKey === `${operator.uid}:save` ? "Saving…" : "Save profile"}
                  </button>
                </div>

                <div className="operator-row__actions" aria-label={`Account actions for ${operator.email}`}>
                  <button
                    type="button"
                    className="account-secondary-button"
                    onClick={() => void sendPasswordReset(operator)}
                    disabled={globallyBusy || protectedOperator}
                    title={protectedOperator ? "Use Account settings to change the owner password" : undefined}
                  >
                    {busyKey === `${operator.uid}:reset` ? "Sending…" : "Send password reset"}
                  </button>
                  <button
                    type="button"
                    className="account-secondary-button"
                    onClick={() => {
                      setReplacementPassword("");
                      setShowReplacementPassword(false);
                      setPasswordTarget(operator);
                    }}
                    disabled={globallyBusy || protectedOperator}
                    title={protectedOperator ? "Use Account settings to change the owner password" : undefined}
                  >
                    Set replacement password
                  </button>
                  <button
                    type="button"
                    className="account-secondary-button"
                    onClick={() => void toggleDisabled(operator)}
                    disabled={globallyBusy || protectedOperator}
                    title={protectedOperator ? "Protected owner accounts cannot be disabled" : undefined}
                  >
                    {busyKey === `${operator.uid}:status`
                      ? "Updating…"
                      : operator.disabled ? "Enable account" : "Disable account"}
                  </button>
                  <button
                    type="button"
                    className="account-danger-button"
                    onClick={() => setDeleteTarget(operator)}
                    disabled={globallyBusy || protectedOperator}
                    title={protectedOperator ? "Protected owner accounts cannot be removed" : undefined}
                  >
                    Remove user
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <dialog
        ref={passwordDialogRef}
        className="operator-dialog operator-dialog--password"
        aria-labelledby="operator-password-title"
        onClose={() => setPasswordTarget(null)}
        onCancel={() => setPasswordTarget(null)}
      >
        <form className="operator-dialog__content" onSubmit={setTemporaryPassword}>
          <span className="section-kicker">Credential control</span>
          <h2 id="operator-password-title">Set a replacement password</h2>
          <p>
            Replace the sign-in password for <strong>{passwordTarget?.email}</strong>. The password will never be displayed after this operation.
          </p>
          <label className="operator-field operator-field--password">
            <span>New replacement password</span>
            <span className="operator-password-control">
              <input
                type={showReplacementPassword ? "text" : "password"}
                value={replacementPassword}
                onChange={(event) => setReplacementPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                disabled={busyKey === `${passwordTarget?.uid}:password`}
              />
              <button
                type="button"
                className="operator-password-toggle"
                onClick={() => setShowReplacementPassword((visible) => !visible)}
                aria-label={showReplacementPassword ? "Hide replacement password" : "Show replacement password"}
              >
                {showReplacementPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          <div className="operator-dialog__actions">
            <button
              type="button"
              className="account-secondary-button"
              onClick={() => setPasswordTarget(null)}
              disabled={busyKey === `${passwordTarget?.uid}:password`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button primary-button--compact"
              disabled={busyKey === `${passwordTarget?.uid}:password`}
            >
              {busyKey === `${passwordTarget?.uid}:password` ? "Updating…" : "Set password"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        className="operator-dialog operator-dialog--danger"
        aria-labelledby="operator-delete-title"
        onClose={() => setDeleteTarget(null)}
        onCancel={() => setDeleteTarget(null)}
      >
        <form className="operator-dialog__content" onSubmit={deleteOperator}>
          <span className="section-kicker">Destructive operation</span>
          <h2 id="operator-delete-title">Remove this user?</h2>
          <p>
            <strong>{deleteTarget?.email}</strong> will lose Dover Controls access and the Firebase identity will be deleted. This action cannot be undone.
          </p>
          <div className="operator-dialog__actions">
            <button
              type="button"
              className="account-secondary-button"
              onClick={() => setDeleteTarget(null)}
              disabled={busyKey === `${deleteTarget?.uid}:delete`}
            >
              Keep user
            </button>
            <button
              type="submit"
              className="account-danger-button"
              disabled={busyKey === `${deleteTarget?.uid}:delete`}
            >
              {busyKey === `${deleteTarget?.uid}:delete` ? "Removing…" : "Permanently remove"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export default UserManagementView;
