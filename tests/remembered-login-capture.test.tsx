import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { act, cleanup, render } from "@testing-library/react";

import RememberedLoginCapture from "../src/app/components/RememberedLoginCapture";
import { readRememberedLogin } from "../src/lib/remembered-login";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("persists the latest validated account", async () => {
  render(
    <RememberedLoginCapture
      user={{
        identity: "google:123",
        provider: "google",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: "https://images.example.com/ada.png",
      }}
    />,
  );
  await act(async () => {});

  assert.deepEqual(readRememberedLogin(), {
    version: 1,
    provider: "google",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://images.example.com/ada.png",
  });
});

test("replaces a prior account after a different provider validates", async () => {
  const { rerender } = render(
    <RememberedLoginCapture
      user={{
        identity: "google:123",
        provider: "google",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
      }}
    />,
  );
  await act(async () => {});

  rerender(
    <RememberedLoginCapture
      user={{
        identity: "github:456",
        provider: "github",
        name: "Grace Hopper",
        email: "grace@example.com",
        image: "https://avatars.example.com/grace.png",
      }}
    />,
  );
  await act(async () => {});

  assert.equal(readRememberedLogin()?.provider, "github");
  assert.equal(readRememberedLogin()?.name, "Grace Hopper");
});

test("ignores an unsupported provider from runtime data", async () => {
  render(
    <RememberedLoginCapture
      user={{
        identity: "microsoft:789",
        provider: "microsoft",
        name: "Katherine Johnson",
        email: "katherine@example.com",
        image: null,
      }}
    />,
  );
  await act(async () => {});

  assert.equal(readRememberedLogin(), null);
});
