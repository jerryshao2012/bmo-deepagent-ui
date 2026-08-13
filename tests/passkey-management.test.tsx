import "./setup-dom";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PasskeyManagementDialog, {
  PasskeyManagementQueryDialog,
} from "../src/app/components/PasskeyManagementDialog";
import { PASSKEY_ENROLLMENT_MARKER_KEY } from "../src/lib/passkey-enrollment-state";
import {
  PASSKEY_MANAGEMENT_RETURN_PATH,
  shouldOpenPasskeyManagement,
} from "../src/lib/oauth-login";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const source = (relativePath: string) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const passkey = {
  credential_id: "Y3JlZGVudGlhbC0x",
  label: "MacBook Touch ID",
  transports: ["internal"],
  device_type: "multi_device",
  backed_up: true,
  created_at: 1_722_000_000,
  last_used_at: null,
};

function json(value: unknown, init?: ResponseInit) {
  return Response.json(value, init);
}

test("lists passkeys and keeps final credential revocable", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method || "GET",
        });
        if ((init?.method || "GET") === "DELETE") return json({ ok: true });
        return json({ passkeys: [passkey] });
      }}
    />
  );

  assert.ok(await screen.findByText("MacBook Touch ID"));
  assert.equal(window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY), "1");
  assert.ok(screen.getByText("Synced passkey"));
  const add = screen.getByRole("button", { name: "Add passkey" });
  window.localStorage.setItem(PASSKEY_ENROLLMENT_MARKER_KEY, "1");
  fireEvent.click(
    screen.getByRole("button", { name: "Revoke MacBook Touch ID" })
  );

  assert.equal(
    requests.some(({ method }) => method === "DELETE"),
    false
  );
  assert.ok(
    screen.getByRole("alertdialog", { name: "Revoke MacBook Touch ID?" })
  );
  assert.ok(screen.getByText("You can still sign in with Google."));
  await waitFor(() =>
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "Confirm revoke MacBook Touch ID"
    )
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm revoke MacBook Touch ID" })
  );

  await waitFor(() =>
    assert.equal(
      requests.some(
        ({ url, method }) =>
          url === "/api/auth/passkeys/Y3JlZGVudGlhbC0x" && method === "DELETE"
      ),
      true
    )
  );
  await waitFor(() =>
    assert.equal(screen.queryByText("MacBook Touch ID"), null)
  );
  assert.ok(screen.getByRole("status", { name: "MacBook Touch ID revoked." }));
  assert.equal(window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY), "1");
  await waitFor(() => assert.equal(document.activeElement === add, true));
});

test("empty passkey list neither creates nor clears the sticky marker", async () => {
  const view = render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () => json({ passkeys: [] })}
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  assert.equal(
    window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY),
    null
  );

  view.unmount();
  window.localStorage.setItem(PASSKEY_ENROLLMENT_MARKER_KEY, "1");
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="github"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () => json({ passkeys: [] })}
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  assert.equal(window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY), "1");
});

test("blocked marker storage does not break a successful list", async () => {
  const storagePrototype = Object.getPrototypeOf(
    window.localStorage
  ) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let writeAttempts = 0;
  storagePrototype.setItem = () => {
    writeAttempts += 1;
    throw new DOMException("Blocked", "SecurityError");
  };

  try {
    render(
      <PasskeyManagementDialog
        open
        onOpenChange={() => {}}
        provider="google"
        oauthBackendUrl="https://backend.example.com"
        fetchImpl={async () => json({ passkeys: [passkey] })}
      />
    );

    assert.ok(await screen.findByText("MacBook Touch ID"));
    assert.equal(screen.queryByRole("alert"), null);
    assert.equal(writeAttempts, 1);
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
});

test("canceling revoke restores focus to its original trigger", async () => {
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () => json({ passkeys: [passkey] })}
    />
  );

  const revoke = await screen.findByRole("button", {
    name: "Revoke MacBook Touch ID",
  });
  fireEvent.click(revoke);
  await waitFor(() =>
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "Confirm revoke MacBook Touch ID"
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() =>
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "Revoke MacBook Touch ID"
    )
  );
});

test("canceling revoke restores the matching trigger when several keys exist", async () => {
  const second = {
    ...passkey,
    credential_id: "Y3JlZGVudGlhbC0y",
    label: "Security key",
  };
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () => json({ passkeys: [passkey, second] })}
    />
  );

  const firstRevoke = await screen.findByRole("button", {
    name: "Revoke MacBook Touch ID",
  });
  fireEvent.click(firstRevoke);
  await waitFor(() =>
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "Confirm revoke MacBook Touch ID"
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() =>
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "Revoke MacBook Touch ID"
    )
  );
});

test("enrolls a named passkey through registration ceremony", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const options = {
    challenge: "challenge",
    rp: { id: "example.com", name: "Example" },
    user: { id: "dXNlcg", name: "ada", displayName: "Ada" },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
  };
  const credential = {
    id: "Y3JlZGVudGlhbC0y",
    rawId: "Y3JlZGVudGlhbC0y",
    type: "public-key",
    response: {
      clientDataJSON: "Y2xpZW50",
      attestationObject: "YXR0ZXN0YXRpb24",
    },
    clientExtensionResults: {},
  };
  let ceremonyOptions: unknown;

  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="github"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        calls.push({ url: String(input), init });
        if (String(input).endsWith("/registration/options")) {
          return json({ ceremony_id: "ceremony-1", options });
        }
        if (String(input).endsWith("/registration/verify")) {
          return json({
            ok: true,
            passkey: {
              ...passkey,
              credential_id: credential.id,
              label: "Phone",
            },
          });
        }
        return json({ passkeys: [] });
      }}
      startRegistrationImpl={async ({ optionsJSON }) => {
        ceremonyOptions = optionsJSON;
        return credential as never;
      }}
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  fireEvent.change(screen.getByRole("textbox", { name: "Passkey label" }), {
    target: { value: " Phone " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

  await screen.findByText("Phone");
  assert.equal(window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY), "1");
  assert.deepEqual(ceremonyOptions, options);
  const verify = calls.find(({ url }) => url.endsWith("/registration/verify"));
  assert.deepEqual(JSON.parse(String(verify?.init?.body)), {
    ceremony_id: "ceremony-1",
    response: credential,
    label: "Phone",
  });
});

test("enrolls without a label and renders the backend-generated default", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        calls.push({ url: String(input), init });
        if (String(input).endsWith("/registration/options")) {
          return json({
            ceremony_id: "ceremony-1",
            options: { challenge: "challenge" },
          });
        }
        if (String(input).endsWith("/registration/verify")) {
          return json({
            ok: true,
            passkey: { ...passkey, label: "Device passkey · Aug 3, 2026" },
          });
        }
        return json({ passkeys: [] });
      }}
      startRegistrationImpl={async () =>
        ({
          id: "Y3JlZGVudGlhbA",
          rawId: "Y3JlZGVudGlhbA",
          type: "public-key",
          response: {
            clientDataJSON: "Y2xpZW50",
            attestationObject: "YXR0ZXN0YXRpb24",
          },
          clientExtensionResults: {},
        } as never)
      }
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  fireEvent.change(screen.getByRole("textbox", { name: "Passkey label" }), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

  assert.ok(await screen.findByText("Device passkey · Aug 3, 2026"));
  assert.equal(screen.queryByText(/Passkey action failed/), null);
  const verify = calls.find(({ url }) => url.endsWith("/registration/verify"));
  assert.deepEqual(JSON.parse(String(verify?.init?.body)), {
    ceremony_id: "ceremony-1",
    response: {
      id: "Y3JlZGVudGlhbA",
      rawId: "Y3JlZGVudGlhbA",
      type: "public-key",
      response: {
        clientDataJSON: "Y2xpZW50",
        attestationObject: "YXR0ZXN0YXRpb24",
      },
      clientExtensionResults: {},
    },
  });
});

test("accepts 100-code-point returned labels and rejects 101", async () => {
  const validLabel = "🔑".repeat(100);
  const view = render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () =>
        json({ passkeys: [{ ...passkey, label: validLabel }] })
      }
    />
  );

  assert.ok(await screen.findByText(validLabel));
  assert.equal(screen.queryByRole("alert"), null);

  view.unmount();
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () =>
        json({ passkeys: [{ ...passkey, label: "🔑".repeat(101) }] })
      }
    />
  );
  assert.ok(await screen.findByRole("alert"));
});

test("rejects ill-formed Unicode labels returned by the backend", async () => {
  for (const label of ["\ud800", "\udc00"]) {
    const view = render(
      <PasskeyManagementDialog
        open
        onOpenChange={() => {}}
        provider="google"
        oauthBackendUrl="https://backend.example.com"
        fetchImpl={async () => json({ passkeys: [{ ...passkey, label }] })}
      />
    );

    assert.ok(await screen.findByRole("alert"));
    view.unmount();
  }
});

test("validates enrollment and rename labels before making requests", async () => {
  const user = userEvent.setup();
  const calls: Array<{ url: string; method: string }> = [];
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        calls.push({ url: String(input), method: init?.method || "GET" });
        return json({ passkeys: [passkey] });
      }}
    />
  );

  const enrollment = screen.getByRole("textbox", { name: "Passkey label" });
  const rename = await screen.findByRole("textbox", {
    name: "Label for MacBook Touch ID",
  });

  await user.type(enrollment, "x".repeat(101));
  assert.equal((enrollment as HTMLInputElement).value, "x".repeat(101));
  await user.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.ok(
    await screen.findByRole("alert", {
      name: "Passkey labels must be 100 characters or fewer.",
    })
  );
  assert.equal(
    calls.some(({ url }) => url.endsWith("/registration/options")),
    false
  );

  await user.clear(rename);
  await user.type(rename, "   ");
  assert.equal((rename as HTMLInputElement).value, "   ");
  await user.click(
    screen.getByRole("button", { name: "Save MacBook Touch ID" })
  );
  assert.ok(
    await screen.findByRole("alert", {
      name: "Enter a passkey label.",
    })
  );
  assert.equal(
    calls.some(({ method }) => method === "PATCH"),
    false
  );
});

test("label validation clears stale errors and focuses the exact field", async () => {
  const user = userEvent.setup();
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        if (String(input).endsWith("/registration/options")) {
          return json({ code: "invalid_request" }, { status: 400 });
        }
        if (init?.method === "PATCH") {
          return json({ code: "invalid_request" }, { status: 400 });
        }
        return json({ passkeys: [passkey] });
      }}
    />
  );

  const enrollment = screen.getByRole("textbox", { name: "Passkey label" });
  const rename = await screen.findByRole("textbox", {
    name: "Label for MacBook Touch ID",
  });

  await user.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.ok(await screen.findByText(/Passkey action failed/));
  await user.type(enrollment, "x".repeat(101));
  await user.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.equal(screen.queryByText(/Passkey action failed/), null);
  assert.ok(
    screen.getByText("Passkey labels must be 100 characters or fewer.")
  );
  assert.equal(document.activeElement, enrollment);

  await user.clear(rename);
  await user.type(rename, "Work laptop");
  await user.click(
    screen.getByRole("button", { name: "Save MacBook Touch ID" })
  );
  assert.ok(await screen.findByText(/Passkey action failed/));
  await user.clear(rename);
  await user.type(rename, "   ");
  await user.click(
    screen.getByRole("button", { name: "Save MacBook Touch ID" })
  );
  assert.equal(screen.queryByText(/Passkey action failed/), null);
  assert.ok(screen.getByText("Enter a passkey label."));
  assert.equal(document.activeElement, rename);
});

test("rejects ill-formed Unicode input before registration or rename requests", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        calls.push({ url: String(input), method: init?.method || "GET" });
        return json({ passkeys: [passkey] });
      }}
    />
  );

  const enrollment = screen.getByRole("textbox", { name: "Passkey label" });
  const rename = await screen.findByRole("textbox", {
    name: "Label for MacBook Touch ID",
  });
  fireEvent.change(enrollment, { target: { value: "\ud800" } });
  fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.ok(
    await screen.findByRole("alert", {
      name: "Passkey labels contain invalid characters.",
    })
  );
  assert.equal(document.activeElement, enrollment);

  fireEvent.change(rename, { target: { value: "\udc00" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save MacBook Touch ID" })
  );
  assert.ok(
    await screen.findByRole("alert", {
      name: "Passkey labels contain invalid characters.",
    })
  );
  assert.equal(document.activeElement, rename);
  assert.equal(
    calls.some(
      ({ url, method }) =>
        url.endsWith("/registration/options") || method === "PATCH"
    ),
    false
  );
});

test("rejects a rename response for a different credential", async () => {
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (_input, init) =>
        init?.method === "PATCH"
          ? json({
              passkey: {
                ...passkey,
                credential_id: "Y3JlZGVudGlhbC0y",
                label: "Work laptop",
              },
            })
          : json({ passkeys: [passkey] })
      }
    />
  );

  const rename = await screen.findByRole("textbox", {
    name: "Label for MacBook Touch ID",
  });
  fireEvent.change(rename, { target: { value: "Work laptop" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save MacBook Touch ID" })
  );

  assert.ok(await screen.findByText(/Passkey action failed/));
  assert.ok(screen.getByText("MacBook Touch ID"));
  assert.equal(screen.queryByText("Work laptop"), null);
});

test("renames a passkey and guards duplicate action clicks", async () => {
  let resolveRename: (response: Response) => void = () => {};
  let renameCount = 0;
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input, init) => {
        if (init?.method === "PATCH") {
          renameCount += 1;
          return new Promise<Response>((resolve) => {
            resolveRename = resolve;
          });
        }
        return json({ passkeys: [passkey] });
      }}
    />
  );

  const input = await screen.findByRole("textbox", {
    name: "Label for MacBook Touch ID",
  });
  fireEvent.change(input, { target: { value: "Work laptop" } });
  const save = screen.getByRole("button", { name: "Save MacBook Touch ID" });
  fireEvent.click(save);
  fireEvent.click(save);

  await waitFor(() => assert.equal(renameCount, 1));
  assert.equal(save.getAttribute("aria-busy"), "true");
  for (const button of screen.getAllByRole("button")) {
    assert.equal(button.hasAttribute("disabled"), true);
  }

  resolveRename(json({ passkey: { ...passkey, label: "Work laptop" } }));
  assert.ok(await screen.findByText("Work laptop"));
});

test("offers manual OAuth reauthentication without replaying sensitive action", async () => {
  const navigations: string[] = [];
  let registrationOptionsCalls = 0;
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com/"
      navigate={(url) => navigations.push(url)}
      fetchImpl={async (input) => {
        if (String(input).endsWith("/registration/options")) {
          registrationOptionsCalls += 1;
          return json(
            { code: "reauth_required", provider: "github" },
            { status: 403 }
          );
        }
        return json({ passkeys: [] });
      }}
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.ok(
    await screen.findByText(
      "Verify again with GitHub, then retry this action manually."
    )
  );
  assert.equal(registrationOptionsCalls, 1);

  const verify = screen.getByRole("button", { name: "Verify with GitHub" });
  assert.ok(screen.getByRole("alert"));
  fireEvent.click(verify);
  fireEvent.click(verify);
  assert.equal(registrationOptionsCalls, 1);
  assert.equal(navigations.length, 1);
  assert.equal(verify.getAttribute("aria-busy"), "true");
  for (const button of screen.getAllByRole("button")) {
    assert.equal(button.hasAttribute("disabled"), true);
  }
  assert.equal(
    navigations[0],
    `https://backend.example.com/auth/login/github?return_path=${encodeURIComponent(
      PASSKEY_MANAGEMENT_RETURN_PATH
    )}`
  );
});

test("recovers from a cross-bundle reauthentication error", async () => {
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input) => {
        if (String(input).endsWith("/registration/options")) {
          throw {
            status: 403,
            code: "reauth_required",
            provider: "google",
          };
        }
        return json({ passkeys: [] });
      }}
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.ok(
    await screen.findByText(
      "Verify again with Google, then retry this action manually."
    )
  );
  assert.equal(screen.queryByText(/Passkey action failed/), null);
});

test("falls back to authenticated provider when 403 provider is invalid", async () => {
  const navigations: string[] = [];
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      navigate={(url) => navigations.push(url)}
      fetchImpl={async () =>
        json(
          { code: "reauth_required", provider: "untrusted" },
          { status: 403 }
        )
      }
    />
  );

  const verify = await screen.findByRole("button", {
    name: "Verify with Google",
  });
  assert.match(
    screen.getByRole("alert").textContent || "",
    /Verify again with Google/
  );
  fireEvent.click(verify);
  assert.equal(
    navigations[0],
    `https://backend.example.com/auth/login/google?return_path=${encodeURIComponent(
      PASSKEY_MANAGEMENT_RETURN_PATH
    )}`
  );
});

for (const code of ["invalid_session", "authentication_required"]) {
  test(`${code} uses authenticated provider despite conflicting backend provider`, async () => {
    const navigations: string[] = [];
    render(
      <PasskeyManagementDialog
        open
        onOpenChange={() => {}}
        provider="google"
        oauthBackendUrl="https://backend.example.com"
        navigate={(url) => navigations.push(url)}
        fetchImpl={async () =>
          json({ code, provider: "github" }, { status: 401 })
        }
      />
    );

    const verify = await screen.findByRole("button", {
      name: "Verify with Google",
    });
    const alert = screen.getByRole("alert");
    assert.match(
      alert.textContent || "",
      code === "invalid_session"
        ? /session expired/i
        : /authentication is required/i
    );
    assert.doesNotMatch(alert.textContent || "", /GitHub/);
    fireEvent.click(verify);
    assert.match(navigations[0] || "", /\/auth\/login\/google\?/);
  });
}

const exactRecoveryCases = [
  {
    status: 429,
    code: "rate_limited",
    message: "Too many passkey requests. Wait one minute, then retry.",
  },
  {
    status: 502,
    code: "authentication_service_unavailable",
    message:
      "Authentication service is temporarily unavailable. Use Google or GitHub, or retry later.",
  },
  {
    status: 503,
    code: "passkeys_unavailable",
    message:
      "Passkey service is temporarily unavailable. Use Google or GitHub, or retry later.",
  },
] as const;

for (const { status, code, message } of exactRecoveryCases) {
  test(`${status} ${code} renders only its safe recovery message`, async () => {
    render(
      <PasskeyManagementDialog
        open
        onOpenChange={() => {}}
        provider="github"
        oauthBackendUrl="https://backend.example.com"
        fetchImpl={async () =>
          json(
            {
              code,
              detail: "secret backend detail",
              message: "untrusted backend message",
              token: "session-token-value",
            },
            { status }
          )
        }
      />
    );

    const alert = await screen.findByRole("alert");
    assert.equal(alert.textContent, message);
    assert.doesNotMatch(
      document.body.textContent || "",
      /secret backend detail|untrusted backend message|session-token-value/
    );
  });
}

const genericFailureCases = [
  { status: 401, body: { code: "reauth_required" } },
  { status: 403, body: { code: "invalid_session" } },
  { status: 502, body: { code: "passkeys_unavailable" } },
  {
    status: 503,
    body: { code: "authentication_service_unavailable" },
  },
  { status: 418, body: { code: "rate_limited" } },
  { status: 500, body: { code: "unknown", detail: "do not render me" } },
] as const;

for (const { status, body } of genericFailureCases) {
  test(`${status} ${body.code} mismatch remains generic`, async () => {
    render(
      <PasskeyManagementDialog
        open
        onOpenChange={() => {}}
        provider="google"
        oauthBackendUrl="https://backend.example.com"
        fetchImpl={async () => json(body, { status })}
      />
    );

    const alert = await screen.findByRole("alert");
    assert.equal(
      alert.textContent,
      "Passkey action failed. Please retry or sign in with your provider."
    );
    assert.doesNotMatch(alert.textContent || "", /do not render me/);
  });
}

test("malformed error response remains generic", async () => {
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () =>
        new Response("not-json secret body", {
          status: 500,
          headers: { "content-type": "text/plain" },
        })
      }
    />
  );

  const alert = await screen.findByRole("alert");
  assert.equal(
    alert.textContent,
    "Passkey action failed. Please retry or sign in with your provider."
  );
  assert.doesNotMatch(document.body.textContent || "", /not-json secret body/);
  assert.equal(
    window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY),
    null
  );
});

test("failed enrollment does not remember passkey availability", async () => {
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input) =>
        String(input).endsWith("/registration/options")
          ? json({ code: "invalid_request" }, { status: 400 })
          : json({ passkeys: [] })
      }
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
  assert.ok(await screen.findByRole("alert"));
  assert.equal(
    window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY),
    null
  );
});

test("treats registration cancellation neutrally and restores actions", async () => {
  const calls: string[] = [];
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input) => {
        calls.push(String(input));
        return String(input).endsWith("/registration/options")
          ? json({ ceremony_id: "ceremony-1", options: { challenge: "value" } })
          : json({ passkeys: [] });
      }}
      startRegistrationImpl={async () => {
        throw new DOMException("Cancelled", "NotAllowedError");
      }}
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  const add = screen.getByRole("button", { name: "Add passkey" });
  fireEvent.click(add);

  await waitFor(() => assert.equal(add.hasAttribute("disabled"), false));
  assert.equal(screen.queryByRole("alert"), null);
  assert.equal(
    window.localStorage.getItem(PASSKEY_ENROLLMENT_MARKER_KEY),
    null
  );
  assert.equal(
    calls.some((url) => url.endsWith("/registration/verify")),
    false
  );
});

test("recovers after a management error", async () => {
  let fail = true;
  render(
    <PasskeyManagementDialog
      open
      onOpenChange={() => {}}
      provider="google"
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async (input) => {
        if (String(input).endsWith("/registration/options") && fail) {
          fail = false;
          return json({ code: "invalid_passkey_response" }, { status: 400 });
        }
        if (String(input).endsWith("/registration/options")) {
          return json({
            ceremony_id: "ceremony-2",
            options: { challenge: "ok" },
          });
        }
        if (String(input).endsWith("/registration/verify")) {
          return json({ ok: true, passkey: { ...passkey, label: "Passkey" } });
        }
        return json({ passkeys: [] });
      }}
      startRegistrationImpl={async () =>
        ({
          id: "Y3JlZGVudGlhbA",
          rawId: "Y3JlZGVudGlhbA",
          type: "public-key",
          response: {
            clientDataJSON: "Y2xpZW50",
            attestationObject: "YXR0ZXN0YXRpb24",
          },
          clientExtensionResults: {},
        } as never)
      }
    />
  );

  await screen.findByText("No passkeys enrolled yet.");
  const add = screen.getByRole("button", { name: "Add passkey" });
  fireEvent.click(add);
  assert.ok(await screen.findByRole("alert"));
  await waitFor(() => assert.equal(add.hasAttribute("disabled"), false));
  fireEvent.click(add);
  assert.ok(await screen.findByText("Passkey"));
});

test("account menu opens management and OAuth return query reopens it", async () => {
  const chat = await source("src/app/chat-page.tsx");

  assert.match(chat, /Manage passkeys/);
  assert.match(chat, /aria-label="Account menu"/);
  assert.match(chat, /<PasskeyManagementQueryDialog/);
  assert.equal(shouldOpenPasskeyManagement("passkeys", true, "google"), true);
  assert.equal(shouldOpenPasskeyManagement("passkeys", false, "google"), false);
  assert.equal(shouldOpenPasskeyManagement("passkeys", true, "forged"), false);
  assert.equal(
    shouldOpenPasskeyManagement(["passkeys"], true, "google"),
    false
  );
});

test("management query gate renders the real dialog only for exact query", async () => {
  const view = render(
    <PasskeyManagementQueryDialog
      manageQuery="other"
      passkeysEnabled
      provider="google"
      onOpenChange={() => {}}
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () => json({ passkeys: [] })}
    />
  );

  assert.equal(screen.queryByRole("dialog", { name: "Manage passkeys" }), null);
  view.rerender(
    <PasskeyManagementQueryDialog
      manageQuery="passkeys"
      passkeysEnabled
      provider="google"
      onOpenChange={() => {}}
      oauthBackendUrl="https://backend.example.com"
      fetchImpl={async () => json({ passkeys: [] })}
    />
  );

  assert.ok(await screen.findByRole("dialog", { name: "Manage passkeys" }));
});

test("server enables management only from trusted passkey configuration", async () => {
  const page = await source("src/app/chat/page.tsx");

  assert.match(page, /isPasskeyBffConfigured\(\)/);
  assert.match(page, /passkeysEnabled=/);
  assert.match(page, /oauthBackendUrl=/);
});
