import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LoginProviders from "../src/app/components/LoginProviders";
import {
  LEGACY_LAST_USED_PROVIDER_KEY,
  REMEMBERED_LOGIN_KEY,
  type LoginProvider,
  writeRememberedLogin,
} from "../src/lib/remembered-login";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderProviders(onSignIn: (provider: LoginProvider) => Promise<void>) {
  return render(<LoginProviders onSignIn={onSignIn} />);
}

test("shows ordinary provider choices without a fake last-used state", async () => {
  renderProviders(async () => {});
  await act(async () => {});

  assert.ok(
    screen.queryByText("LAST USED") === null,
    "LAST USED badge should not be rendered",
  );
  assert.ok(screen.getByRole("button", { name: "Google" }));
  assert.ok(screen.getByRole("button", { name: "Github" }));
  assert.ok(
    screen.queryByRole("button", { name: /Continue as/i }) === null,
    "remembered account action should not be rendered",
  );
});

test("hydrates a remembered Google account and dispatches its provider", async () => {
  writeRememberedLogin({
    provider: "google",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://images.example.com/ada.png",
  });
  const calls: LoginProvider[] = [];
  const beforeClick = localStorage.getItem(REMEMBERED_LOGIN_KEY);

  renderProviders(async (provider) => {
    calls.push(provider);
  });

  await act(async () => {});
  const continueButton = screen.getByRole("button", {
    name: "Continue as Ada Lovelace with Google",
  });
  assert.ok(screen.getByText("ada@example.com"));
  assert.ok(screen.getByText("AL"));

  await userEvent.setup({ document }).click(continueButton);

  assert.deepEqual(calls, ["google"]);
  assert.equal(localStorage.getItem(REMEMBERED_LOGIN_KEY), beforeClick);
  assert.equal(localStorage.getItem(LEGACY_LAST_USED_PROVIDER_KEY), null);
  assert.equal(continueButton.hasAttribute("disabled"), false);
});

test("uses email fallback and dispatches a remembered GitHub account", async () => {
  writeRememberedLogin({
    provider: "github",
    email: "grace@example.com",
    avatarUrl: "javascript:alert(1)",
  });
  const calls: LoginProvider[] = [];

  renderProviders(async (provider) => {
    calls.push(provider);
  });

  await act(async () => {});
  const continueButton = screen.getByRole("button", {
    name: "Continue as grace@example.com with GitHub",
  });
  assert.ok(
    screen.queryByRole("img") === null,
    "unsafe avatar should not be rendered",
  );
  assert.ok(screen.getByText("GR"));

  await userEvent.setup({ document }).click(continueButton);

  assert.deepEqual(calls, ["github"]);
});

test("malformed storage falls back to provider choices", async () => {
  localStorage.setItem(REMEMBERED_LOGIN_KEY, "not-json");

  renderProviders(async () => {});

  await act(async () => {});
  assert.equal(localStorage.getItem(REMEMBERED_LOGIN_KEY), null);
  assert.ok(
    screen.queryByRole("button", { name: /Continue as/i }) === null,
    "malformed storage should not render a remembered account action",
  );
  assert.ok(screen.getByRole("button", { name: "Google" }));
});

test("disables every action and guards duplicate sign-in attempts", async () => {
  writeRememberedLogin({ provider: "google", name: "Ada Lovelace" });
  let rejectSignIn: (error: Error) => void = () => {};
  let callCount = 0;
  const onSignIn = () => {
    callCount += 1;
    return new Promise<void>((_, reject) => {
      rejectSignIn = reject;
    });
  };

  renderProviders(onSignIn);

  await act(async () => {});
  const continueButton = screen.getByRole("button", {
    name: "Continue as Ada Lovelace with Google",
  });
  fireEvent.click(continueButton);
  fireEvent.click(continueButton);

  await waitFor(() => assert.equal(callCount, 1));
  for (const button of screen.getAllByRole("button")) {
    assert.equal(button.hasAttribute("disabled"), true);
  }
  assert.equal(continueButton.getAttribute("aria-busy"), "true");

  rejectSignIn(new Error("OAuth failed"));
  await waitFor(() => assert.equal(continueButton.hasAttribute("disabled"), false));
});

test("failed provider sign-in restores all actions", async () => {
  renderProviders(async () => {
    throw new Error("OAuth failed");
  });

  const googleButton = screen.getByRole("button", { name: "Google" });
  await userEvent.setup({ document }).click(googleButton);

  await waitFor(() => assert.equal(googleButton.hasAttribute("disabled"), false));
  assert.equal(googleButton.getAttribute("aria-busy"), "false");
  assert.equal(screen.getByRole("button", { name: "Github" }).hasAttribute("disabled"), false);
});

test("restores actions when a redirect returns from the browser back-forward cache", async () => {
  renderProviders(async () => {
    throw { digest: "NEXT_REDIRECT;replace;https://accounts.example.com;307;" };
  });

  const googleButton = screen.getByRole("button", { name: "Google" });
  fireEvent.click(googleButton);
  await act(async () => {});
  assert.equal(googleButton.hasAttribute("disabled"), true);

  const pageShow = new window.Event("pageshow");
  Object.defineProperty(pageShow, "persisted", { value: true });
  await act(async () => {
    window.dispatchEvent(pageShow);
  });
  assert.equal(googleButton.hasAttribute("disabled"), false);
  assert.equal(googleButton.getAttribute("aria-busy"), "false");
});
