import "./setup-dom";

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import LoginProviders from "../src/app/components/LoginProviders";
import {
  authenticateWithPasskey,
  isPasskeyCancellation,
} from "../src/lib/passkey-client";
import { PASSKEY_ENROLLMENT_MARKER_KEY } from "../src/lib/passkey-enrollment-state";

function seedPasskeyEnrollmentMarker(value = "1") {
  localStorage.setItem(PASSKEY_ENROLLMENT_MARKER_KEY, value);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("shows passkey sign-in above OAuth alternatives for an enrolled browser", async () => {
  seedPasskeyEnrollmentMarker();

  const { container } = render(
    <LoginProviders
      onSignIn={async () => {}}
      passkeysEnabled
      supportsPasskeys={() => true}
      onPasskeySignIn={async () => {}}
    />
  );

  await act(async () => {});

  const passkey = screen.getByRole("button", {
    name: "Sign in with a passkey",
  });
  const google = screen.getByRole("button", { name: "Google" });
  assert.ok(
    Node.DOCUMENT_POSITION_FOLLOWING & passkey.compareDocumentPosition(google)
  );
  assert.ok(container.contains(screen.getByRole("button", { name: "Github" })));
});

test("hides passkey sign-in when enrollment marker is absent", async () => {
  render(
    <LoginProviders
      onSignIn={async () => {}}
      passkeysEnabled
      supportsPasskeys={() => true}
      onPasskeySignIn={async () => {}}
    />
  );

  assert.equal(
    Boolean(screen.queryByRole("button", { name: "Sign in with a passkey" })),
    false
  );
});

test("hides passkey sign-in when enrollment marker is malformed", async () => {
  seedPasskeyEnrollmentMarker("true");

  render(
    <LoginProviders
      onSignIn={async () => {}}
      passkeysEnabled
      supportsPasskeys={() => true}
      onPasskeySignIn={async () => {}}
    />
  );

  assert.equal(
    Boolean(screen.queryByRole("button", { name: "Sign in with a passkey" })),
    false
  );
});

test("hides passkey sign-in when enrollment marker storage cannot be read", async () => {
  const storagePrototype = Object.getPrototypeOf(window.localStorage);
  const originalGetItem = storagePrototype.getItem;
  storagePrototype.getItem = () => {
    throw new Error("storage blocked");
  };

  try {
    render(
      <LoginProviders
        onSignIn={async () => {}}
        passkeysEnabled
        supportsPasskeys={() => true}
        onPasskeySignIn={async () => {}}
      />
    );

    assert.equal(
      Boolean(screen.queryByRole("button", { name: "Sign in with a passkey" })),
      false
    );
  } finally {
    storagePrototype.getItem = originalGetItem;
  }
});

test("keeps OAuth usable when passkey sign-in is hidden", async () => {
  const signIns: string[] = [];
  render(
    <LoginProviders
      onSignIn={async (provider) => {
        signIns.push(provider);
      }}
      passkeysEnabled
      supportsPasskeys={() => true}
      onPasskeySignIn={async () => {}}
    />
  );

  assert.equal(
    Boolean(screen.queryByRole("button", { name: "Sign in with a passkey" })),
    false
  );
  fireEvent.click(screen.getByRole("button", { name: "Google" }));
  await waitFor(() => assert.deepEqual(signIns, ["google"]));
});

test("hides passkey sign-in when WebAuthn is unavailable", async () => {
  render(
    <LoginProviders
      onSignIn={async () => {}}
      passkeysEnabled
      supportsPasskeys={() => false}
      onPasskeySignIn={async () => {}}
    />
  );

  await act(async () => {});

  assert.equal(
    screen.queryByRole("button", { name: "Sign in with a passkey" }),
    null
  );
  assert.ok(screen.getByRole("button", { name: "Google" }));
  assert.ok(screen.getByRole("button", { name: "Github" }));
});

test("passkeys default disabled even when browser supports WebAuthn", async () => {
  render(
    <LoginProviders
      onSignIn={async () => {}}
      supportsPasskeys={() => true}
      onPasskeySignIn={async () => {}}
    />
  );
  await act(async () => {});

  assert.equal(
    screen.queryByRole("button", { name: "Sign in with a passkey" }),
    null
  );
});

test("guards duplicate passkey ceremonies and disables every sign-in action", async () => {
  seedPasskeyEnrollmentMarker();

  let finish: () => void = () => {};
  let callCount = 0;
  const ceremony = () => {
    callCount += 1;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  render(
    <LoginProviders
      onSignIn={async () => {}}
      passkeysEnabled
      supportsPasskeys={() => true}
      onPasskeySignIn={ceremony}
    />
  );
  await act(async () => {});

  const passkey = screen.getByRole("button", {
    name: "Sign in with a passkey",
  });
  fireEvent.click(passkey);
  fireEvent.click(passkey);

  await waitFor(() => assert.equal(callCount, 1));
  assert.equal(passkey.getAttribute("aria-busy"), "true");
  for (const button of screen.getAllByRole("button")) {
    assert.equal(button.hasAttribute("disabled"), true);
  }

  finish();
  await waitFor(() => assert.equal(passkey.hasAttribute("disabled"), false));
});

test("restores OAuth fallback when passkey ceremony fails", async () => {
  seedPasskeyEnrollmentMarker();

  render(
    <LoginProviders
      onSignIn={async () => {}}
      passkeysEnabled
      supportsPasskeys={() => true}
      onPasskeySignIn={async () => {
        throw new Error("authenticator failed");
      }}
    />
  );
  await act(async () => {});

  const passkey = screen.getByRole("button", {
    name: "Sign in with a passkey",
  });
  fireEvent.click(passkey);

  await waitFor(() => assert.equal(passkey.hasAttribute("disabled"), false));
  assert.equal(passkey.getAttribute("aria-busy"), "false");
  assert.equal(
    screen.getByRole("button", { name: "Google" }).hasAttribute("disabled"),
    false
  );
  assert.equal(
    screen.getByRole("button", { name: "Github" }).hasAttribute("disabled"),
    false
  );
});

test("runs identifier-free browser ceremony through same-origin BFF", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const options = {
    challenge: "challenge",
    rpId: "example.com",
    timeout: 300_000,
    userVerification: "required",
    allowCredentials: [],
  };
  const assertion = { id: "credential-id", response: { signature: "sig" } };
  let navigatedTo = "";

  const user = await (authenticateWithPasskey as any)({
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) {
        return Response.json({ ceremony_id: "ceremony-123", options });
      }
      return Response.json({
        ok: true,
        user: { provider: "google", auth_method: "passkey", name: "Ada" },
      });
    },
    startAuthenticationImpl: async ({
      optionsJSON,
    }: {
      optionsJSON: unknown;
    }) => {
      assert.deepEqual(optionsJSON, options);
      return assertion;
    },
    navigate: (url: string) => {
      navigatedTo = url;
    },
  });

  assert.equal(requests[0].url, "/api/auth/passkeys/authentication/options");
  assert.equal(requests[1].url, "/api/auth/passkeys/authentication/verify");
  assert.equal(requests[1].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
    ceremony_id: "ceremony-123",
    response: assertion,
  });
  assert.deepEqual(user, {
    provider: "google",
    auth_method: "passkey",
    name: "Ada",
  });
  assert.equal(navigatedTo, "/chat");
});

test("binds passkey sign-in requests to the global fetch receiver", async () => {
  const requests: string[] = [];
  const browserFetch = function (
    this: unknown,
    input: RequestInfo | URL
  ): Promise<Response> {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    requests.push(String(input));
    return Promise.resolve(
      requests.length === 1
        ? Response.json({
            ceremony_id: "ceremony-123",
            options: { challenge: "challenge" },
          })
        : Response.json({
            ok: true,
            user: { provider: "google", auth_method: "passkey" },
          })
    );
  } as typeof fetch;

  await (authenticateWithPasskey as any)({
    fetchImpl: browserFetch,
    startAuthenticationImpl: async () => ({ id: "credential-id" }),
    navigate: () => {},
  });

  assert.deepEqual(requests, [
    "/api/auth/passkeys/authentication/options",
    "/api/auth/passkeys/authentication/verify",
  ]);
});

test("treats browser cancellation and authenticator timeout as neutral", () => {
  assert.equal(isPasskeyCancellation({ name: "AbortError" }), true);
  assert.equal(isPasskeyCancellation({ name: "NotAllowedError" }), true);
  assert.equal(isPasskeyCancellation({ code: "ERROR_CEREMONY_ABORTED" }), true);
  assert.equal(isPasskeyCancellation(new Error("network failed")), false);
});

test("does not navigate when BFF verification fails", async () => {
  let navigated = false;

  await assert.rejects(
    (authenticateWithPasskey as any)({
      fetchImpl: async (input: RequestInfo | URL) =>
        String(input).endsWith("/options")
          ? Response.json({
              ceremony_id: "ceremony-123",
              options: { challenge: "challenge" },
            })
          : Response.json({ code: "invalid_credential" }, { status: 401 }),
      startAuthenticationImpl: async () => ({ id: "credential-id" }),
      navigate: () => {
        navigated = true;
      },
    }),
    /Passkey sign-in failed/
  );

  assert.equal(navigated, false);
});
