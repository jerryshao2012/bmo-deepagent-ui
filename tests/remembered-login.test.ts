import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_LAST_USED_PROVIDER_KEY,
  REMEMBERED_LOGIN_KEY,
  clearRememberedLogin,
  readRememberedLogin,
  writeRememberedLogin,
} from "../src/lib/remembered-login";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("round-trips normalized Google and GitHub accounts", () => {
  for (const provider of ["google", "github"] as const) {
    const storage = new MemoryStorage();

    const saved = writeRememberedLogin(
      {
        provider,
        name: "  Ada Lovelace  ",
        email: "  ada@example.com  ",
        avatarUrl: "https://images.example.com/ada.png",
      },
      storage,
    );

    assert.deepEqual(saved, {
      version: 1,
      provider,
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarUrl: "https://images.example.com/ada.png",
    });
    assert.deepEqual(readRememberedLogin(storage), saved);
  }
});

test("rejects malformed, unsupported, and anonymous records", () => {
  const storage = new MemoryStorage();

  for (const value of [
    "not-json",
    JSON.stringify({ version: 1, provider: "microsoft", name: "Ada" }),
    JSON.stringify({ version: 1, provider: "google", name: " ", email: "" }),
    JSON.stringify({ version: 2, provider: "google", name: "Ada" }),
  ]) {
    storage.setItem(REMEMBERED_LOGIN_KEY, value);
    assert.equal(readRememberedLogin(storage), null);
    assert.equal(storage.getItem(REMEMBERED_LOGIN_KEY), null);
  }
});

test("bounds display fields and discards unsafe avatar URLs", () => {
  const storage = new MemoryStorage();
  const oversizedName = "n".repeat(201);
  const oversizedEmail = `${"e".repeat(310)}@example.com`;

  assert.equal(
    writeRememberedLogin(
      { provider: "google", name: oversizedName, email: oversizedEmail },
      storage,
    ),
    null,
  );

  for (const avatarUrl of [
    "http://images.example.com/ada.png",
    "javascript:alert(1)",
    `https://example.com/${"a".repeat(2049)}`,
    "not-a-url",
  ]) {
    const saved = writeRememberedLogin(
      { provider: "google", name: "Ada", avatarUrl },
      storage,
    );

    assert.equal(saved?.avatarUrl, null);
  }
});

test("storage failures never escape to callers", () => {
  const failingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  assert.equal(readRememberedLogin(failingStorage), null);
  assert.equal(
    writeRememberedLogin({ provider: "google", name: "Ada" }, failingStorage),
    null,
  );
  assert.doesNotThrow(() => clearRememberedLogin(failingStorage));
});

test("reading and clearing retire the legacy provider key", () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_LAST_USED_PROVIDER_KEY, "google");

  assert.equal(readRememberedLogin(storage), null);
  assert.equal(storage.getItem(LEGACY_LAST_USED_PROVIDER_KEY), null);

  storage.setItem(REMEMBERED_LOGIN_KEY, "{}");
  storage.setItem(LEGACY_LAST_USED_PROVIDER_KEY, "github");
  clearRememberedLogin(storage);

  assert.equal(storage.getItem(REMEMBERED_LOGIN_KEY), null);
  assert.equal(storage.getItem(LEGACY_LAST_USED_PROVIDER_KEY), null);
});
