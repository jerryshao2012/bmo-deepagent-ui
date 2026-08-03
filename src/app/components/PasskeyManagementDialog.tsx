"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { KeyRound, Laptop, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  buildOAuthLoginUrl,
  PASSKEY_MANAGEMENT_RETURN_PATH,
  shouldOpenPasskeyManagement,
} from "@/lib/oauth-login";
import { isPasskeyCancellation } from "@/lib/passkey-client";
import { isLoginProvider, type LoginProvider } from "@/lib/remembered-login";

export interface ManagedPasskey {
  credential_id: string;
  label: string;
  transports: string[];
  device_type: string;
  backed_up: boolean;
  created_at: number;
  last_used_at: number | null;
}

export interface PasskeyManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: LoginProvider;
  oauthBackendUrl: string;
  fetchImpl?: typeof fetch;
  startRegistrationImpl?: typeof startRegistration;
  navigate?: (url: string) => void;
}

interface PasskeyManagementQueryDialogProps
  extends Omit<PasskeyManagementDialogProps, "open" | "provider"> {
  manageQuery: unknown;
  passkeysEnabled: boolean;
  provider: unknown;
}

type Operation =
  | "load"
  | "add"
  | "reauth"
  | `rename:${string}`
  | `delete:${string}`;

type LabelErrorTarget =
  | { kind: "enrollment" }
  | { kind: "rename"; credentialId: string };

class ManagementRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    public readonly provider: LoginProvider | null
  ) {
    super("Passkey management request failed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProvider(value: unknown): value is LoginProvider {
  return value === "google" || value === "github";
}

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function parsePasskey(value: unknown): ManagedPasskey | null {
  if (!isRecord(value)) return null;
  const rawLabel = typeof value.label === "string" ? value.label : "";
  const label = rawLabel.trim();
  if (
    typeof value.credential_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,2048}$/.test(value.credential_id) ||
    !isWellFormedUnicode(rawLabel) ||
    !label ||
    Array.from(label).length > 100 ||
    !Array.isArray(value.transports) ||
    !value.transports.every((item) => typeof item === "string") ||
    typeof value.device_type !== "string" ||
    typeof value.backed_up !== "boolean" ||
    typeof value.created_at !== "number" ||
    (value.last_used_at !== null && typeof value.last_used_at !== "number")
  ) {
    return null;
  }
  return {
    credential_id: value.credential_id,
    label,
    transports: value.transports,
    device_type: value.device_type,
    backed_up: value.backed_up,
    created_at: value.created_at,
    last_used_at: value.last_used_at,
  };
}

const LABEL_TOO_LONG = "Passkey labels must be 100 characters or fewer.";
const LABEL_REQUIRED = "Enter a passkey label.";
const LABEL_INVALID = "Passkey labels contain invalid characters.";

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit
) {
  const response = await fetchImpl(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const result = await responseJson(response);
  if (!response.ok) {
    const code =
      isRecord(result) && typeof result.code === "string" ? result.code : null;
    const provider =
      isRecord(result) && isProvider(result.provider) ? result.provider : null;
    throw new ManagementRequestError(response.status, code, provider);
  }
  return result;
}

function providerName(provider: LoginProvider) {
  return provider === "google" ? "Google" : "GitHub";
}

export default function PasskeyManagementDialog({
  open,
  onOpenChange,
  provider,
  oauthBackendUrl,
  fetchImpl = fetch,
  startRegistrationImpl = startRegistration,
  navigate = (url) => window.location.assign(url),
}: PasskeyManagementDialogProps) {
  const [passkeys, setPasskeys] = useState<ManagedPasskey[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<{
    target: LabelErrorTarget;
    message: string;
  } | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [reauthProvider, setReauthProvider] = useState<LoginProvider | null>(
    null
  );
  const [confirmingCredentialId, setConfirmingCredentialId] = useState<
    string | null
  >(null);
  const operationRef = useRef<Operation | null>(null);
  const newLabelInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const revokeTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const confirmRevokeRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterRevokeRef = useRef(false);
  const cancelFocusCredentialRef = useRef<string | null>(null);

  const begin = useCallback((next: Operation) => {
    if (operationRef.current) return false;
    operationRef.current = next;
    setOperation(next);
    setError(null);
    setLabelError(null);
    setAnnouncement(null);
    setReauthProvider(null);
    return true;
  }, []);

  const finish = useCallback(() => {
    operationRef.current = null;
    setOperation(null);
  }, []);

  const handleError = useCallback((caught: unknown) => {
    if (
      caught instanceof ManagementRequestError &&
      caught.status === 403 &&
      caught.code === "reauth_required" &&
      caught.provider
    ) {
      setReauthProvider(caught.provider);
      return;
    }
    if (!isPasskeyCancellation(caught)) {
      setError(
        "Passkey action failed. Please retry or sign in with your provider."
      );
    }
  }, []);

  useEffect(() => {
    if (!open || !begin("load")) return;
    let current = true;
    void requestJson(fetchImpl, "/api/auth/passkeys")
      .then((result) => {
        if (!current || !isRecord(result) || !Array.isArray(result.passkeys)) {
          if (current) throw new Error("Invalid passkey list");
          return;
        }
        const parsed = result.passkeys.map(parsePasskey);
        if (parsed.some((item) => item === null)) {
          throw new Error("Invalid passkey list");
        }
        const next = parsed as ManagedPasskey[];
        setPasskeys(next);
        setDrafts(
          Object.fromEntries(
            next.map((item) => [item.credential_id, item.label])
          )
        );
      })
      .catch((caught) => {
        if (current) handleError(caught);
      })
      .finally(() => {
        if (current) finish();
      });
    return () => {
      current = false;
      operationRef.current = null;
    };
  }, [begin, fetchImpl, finish, handleError, open]);

  useEffect(() => {
    if (!focusAfterRevokeRef.current) return;
    focusAfterRevokeRef.current = false;
    addButtonRef.current?.focus();
  }, [passkeys]);

  useEffect(() => {
    if (confirmingCredentialId) {
      confirmRevokeRef.current?.focus();
      return;
    }
    const credentialId = cancelFocusCredentialRef.current;
    if (!credentialId) return;
    cancelFocusCredentialRef.current = null;
    revokeTriggerRefs.current.get(credentialId)?.focus();
  }, [confirmingCredentialId]);

  const addPasskey = async () => {
    const label = newLabel.trim();
    const validationMessage = !isWellFormedUnicode(newLabel)
      ? LABEL_INVALID
      : Array.from(label).length > 100
      ? LABEL_TOO_LONG
      : null;
    if (validationMessage) {
      setError(null);
      setLabelError({
        target: { kind: "enrollment" },
        message: validationMessage,
      });
      setAnnouncement(null);
      setReauthProvider(null);
      newLabelInputRef.current?.focus();
      return;
    }
    if (!begin("add")) return;
    try {
      const ceremony = await requestJson(
        fetchImpl,
        "/api/auth/passkeys/registration/options",
        { method: "POST" }
      );
      if (
        !isRecord(ceremony) ||
        typeof ceremony.ceremony_id !== "string" ||
        !ceremony.ceremony_id ||
        !isRecord(ceremony.options)
      ) {
        throw new Error("Invalid registration options");
      }
      const response: RegistrationResponseJSON = await startRegistrationImpl({
        optionsJSON:
          ceremony.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      const payload = await requestJson(
        fetchImpl,
        "/api/auth/passkeys/registration/verify",
        {
          method: "POST",
          body: JSON.stringify({
            ceremony_id: ceremony.ceremony_id,
            response,
            ...(label ? { label } : {}),
          }),
        }
      );
      const enrolled = isRecord(payload) ? parsePasskey(payload.passkey) : null;
      if (!enrolled) {
        throw new Error("Invalid registration response");
      }
      setPasskeys((current) => [...current, enrolled]);
      setDrafts((current) => ({
        ...current,
        [enrolled.credential_id]: enrolled.label,
      }));
      setNewLabel("");
    } catch (caught) {
      handleError(caught);
    } finally {
      finish();
    }
  };

  const renamePasskey = async (passkey: ManagedPasskey) => {
    const key: Operation = `rename:${passkey.credential_id}`;
    const rawLabel = drafts[passkey.credential_id] || "";
    const label = rawLabel.trim();
    const validationMessage = !isWellFormedUnicode(rawLabel)
      ? LABEL_INVALID
      : !label
      ? LABEL_REQUIRED
      : Array.from(label).length > 100
      ? LABEL_TOO_LONG
      : null;
    if (validationMessage) {
      setError(null);
      setLabelError({
        target: { kind: "rename", credentialId: passkey.credential_id },
        message: validationMessage,
      });
      setAnnouncement(null);
      setReauthProvider(null);
      renameInputRefs.current.get(passkey.credential_id)?.focus();
      return;
    }
    if (!begin(key)) return;
    try {
      const payload = await requestJson(
        fetchImpl,
        `/api/auth/passkeys/${encodeURIComponent(passkey.credential_id)}`,
        { method: "PATCH", body: JSON.stringify({ label }) }
      );
      const renamed = isRecord(payload) ? parsePasskey(payload.passkey) : null;
      if (!renamed || renamed.credential_id !== passkey.credential_id) {
        throw new Error("Invalid rename response");
      }
      setPasskeys((current) =>
        current.map((item) =>
          item.credential_id === renamed.credential_id ? renamed : item
        )
      );
      setDrafts((current) => ({
        ...current,
        [renamed.credential_id]: renamed.label,
      }));
    } catch (caught) {
      handleError(caught);
    } finally {
      finish();
    }
  };

  const revokePasskey = async (passkey: ManagedPasskey) => {
    const key: Operation = `delete:${passkey.credential_id}`;
    if (!begin(key)) return;
    try {
      const payload = await requestJson(
        fetchImpl,
        `/api/auth/passkeys/${encodeURIComponent(passkey.credential_id)}`,
        { method: "DELETE" }
      );
      if (!isRecord(payload) || payload.ok !== true) {
        throw new Error("Invalid revoke response");
      }
      focusAfterRevokeRef.current = true;
      setPasskeys((current) =>
        current.filter((item) => item.credential_id !== passkey.credential_id)
      );
      cancelFocusCredentialRef.current = null;
      setConfirmingCredentialId(null);
      setAnnouncement(`${passkey.label || "Passkey"} revoked.`);
    } catch (caught) {
      handleError(caught);
    } finally {
      finish();
    }
  };

  const reauthenticate = () => {
    const currentProvider = reauthProvider;
    if (!currentProvider || operationRef.current) return;
    operationRef.current = "reauth";
    setOperation("reauth");
    setError(null);
    try {
      navigate(
        buildOAuthLoginUrl(
          oauthBackendUrl,
          currentProvider,
          PASSKEY_MANAGEMENT_RETURN_PATH
        )
      );
    } catch {
      finish();
      setError("Could not start verification. Please retry.");
    }
  };

  const busy = operation !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound aria-hidden="true" />
            Manage passkeys
          </DialogTitle>
          <DialogDescription>
            Passkeys let you sign in with your device. Google or GitHub remains
            available for recovery.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {labelError && (
          <p
            id="passkey-label-error"
            role="alert"
            aria-label={labelError.message}
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {labelError.message}
          </p>
        )}

        {announcement && (
          <p
            role="status"
            aria-live="polite"
            aria-label={announcement}
            className="sr-only"
          >
            {announcement}
          </p>
        )}

        {reauthProvider && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            <p>
              Verify again with {providerName(reauthProvider)}, then retry this
              action manually.
            </p>
            <Button
              className="mt-3"
              disabled={busy}
              aria-busy={operation === "reauth"}
              onClick={reauthenticate}
            >
              Verify with {providerName(reauthProvider)}
            </Button>
          </div>
        )}

        <section
          aria-labelledby="enroll-passkey-heading"
          className="space-y-3 rounded-lg border p-4"
        >
          <div>
            <h3
              id="enroll-passkey-heading"
              className="font-medium"
            >
              Add a passkey
            </h3>
            <p className="text-sm text-muted-foreground">
              Use a device unlock, password manager, or security key.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={newLabelInputRef}
              aria-label="Passkey label"
              aria-invalid={labelError?.target.kind === "enrollment"}
              aria-describedby={
                labelError?.target.kind === "enrollment"
                  ? "passkey-label-error"
                  : undefined
              }
              placeholder="Optional label, e.g. Work laptop"
              value={newLabel}
              disabled={busy}
              onChange={(event) => {
                setNewLabel(event.target.value);
                if (labelError?.target.kind === "enrollment") {
                  setLabelError(null);
                }
              }}
            />
            <Button
              ref={addButtonRef}
              disabled={busy}
              aria-busy={operation === "add"}
              onClick={() => void addPasskey()}
            >
              <Plus aria-hidden="true" />
              Add passkey
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="saved-passkeys-heading"
          className="space-y-3"
        >
          <h3
            id="saved-passkeys-heading"
            className="font-medium"
          >
            Saved passkeys
          </h3>
          {operation === "load" ? (
            <p
              role="status"
              className="text-sm text-muted-foreground"
            >
              Loading passkeys…
            </p>
          ) : passkeys.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No passkeys enrolled yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {passkeys.map((passkey) => (
                <li
                  key={passkey.credential_id}
                  className="rounded-lg border p-4"
                >
                  <div className="mb-3 flex items-start gap-3">
                    <Laptop
                      className="mt-0.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {passkey.label || "Passkey"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {passkey.backed_up
                          ? "Synced passkey"
                          : "Device-bound passkey"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      ref={(element) => {
                        if (element) {
                          renameInputRefs.current.set(
                            passkey.credential_id,
                            element
                          );
                        } else {
                          renameInputRefs.current.delete(passkey.credential_id);
                        }
                      }}
                      aria-label={`Label for ${passkey.label || "Passkey"}`}
                      aria-invalid={
                        labelError?.target.kind === "rename" &&
                        labelError.target.credentialId === passkey.credential_id
                      }
                      aria-describedby={
                        labelError?.target.kind === "rename" &&
                        labelError.target.credentialId === passkey.credential_id
                          ? "passkey-label-error"
                          : undefined
                      }
                      value={drafts[passkey.credential_id] ?? passkey.label}
                      disabled={busy}
                      onChange={(event) => {
                        setDrafts((current) => ({
                          ...current,
                          [passkey.credential_id]: event.target.value,
                        }));
                        if (
                          labelError?.target.kind === "rename" &&
                          labelError.target.credentialId ===
                            passkey.credential_id
                        ) {
                          setLabelError(null);
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      disabled={busy}
                      aria-label={`Save ${passkey.label || "Passkey"}`}
                      aria-busy={
                        operation === `rename:${passkey.credential_id}`
                      }
                      onClick={() => void renamePasskey(passkey)}
                    >
                      <Save aria-hidden="true" />
                      Save
                    </Button>
                    {confirmingCredentialId !== passkey.credential_id && (
                      <Button
                        ref={(element) => {
                          if (element) {
                            revokeTriggerRefs.current.set(
                              passkey.credential_id,
                              element
                            );
                          } else {
                            revokeTriggerRefs.current.delete(
                              passkey.credential_id
                            );
                          }
                        }}
                        variant="destructive"
                        disabled={busy}
                        aria-label={`Revoke ${passkey.label || "Passkey"}`}
                        onClick={() => {
                          cancelFocusCredentialRef.current =
                            passkey.credential_id;
                          setConfirmingCredentialId(passkey.credential_id);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        Revoke
                      </Button>
                    )}
                  </div>
                  {confirmingCredentialId === passkey.credential_id && (
                    <div
                      role="alertdialog"
                      aria-labelledby={`revoke-${passkey.credential_id}`}
                      className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3"
                    >
                      <p
                        id={`revoke-${passkey.credential_id}`}
                        className="font-medium"
                      >
                        Revoke {passkey.label || "Passkey"}?
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        You can still sign in with {providerName(provider)}.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          ref={confirmRevokeRef}
                          variant="destructive"
                          disabled={busy}
                          aria-label={`Confirm revoke ${
                            passkey.label || "Passkey"
                          }`}
                          aria-busy={
                            operation === `delete:${passkey.credential_id}`
                          }
                          onClick={() => void revokePasskey(passkey)}
                        >
                          Confirm revoke
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setConfirmingCredentialId(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function PasskeyManagementQueryDialog({
  manageQuery,
  passkeysEnabled,
  provider,
  ...dialogProps
}: PasskeyManagementQueryDialogProps) {
  if (!isLoginProvider(provider)) return null;

  return (
    <PasskeyManagementDialog
      {...dialogProps}
      open={shouldOpenPasskeyManagement(manageQuery, passkeysEnabled, provider)}
      provider={provider}
    />
  );
}
