import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  hasSeenPasskeyEnrollment,
  PASSKEY_ENROLLMENT_MARKER_KEY,
  rememberPasskeyEnrollment,
} from "../src/lib/passkey-enrollment-state";

type TestStorage = Pick<Storage, "getItem" | "setItem">;

function storageWithValue(value: string | null): TestStorage {
  return {
    getItem: () => value,
    setItem: () => {},
  };
}

test("recognizes only the exact passkey enrollment marker", () => {
  assert.equal(PASSKEY_ENROLLMENT_MARKER_KEY, "passkey_enrollment_seen_v1");
  assert.equal(hasSeenPasskeyEnrollment(storageWithValue("1")), true);

  for (const value of [null, "", "0", "true", "2", '{"provider":"google"}']) {
    assert.equal(hasSeenPasskeyEnrollment(storageWithValue(value)), false);
  }
});

test("returns false when storage is absent or unreadable", () => {
  assert.equal(hasSeenPasskeyEnrollment(null), false);
  assert.equal(
    hasSeenPasskeyEnrollment({
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {},
    }),
    false
  );
});

test("returns false without a browser window", () => {
  const moduleUrl = new URL(
    "../src/lib/passkey-enrollment-state.ts",
    import.meta.url
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `const marker = await import(${JSON.stringify(
        moduleUrl
      )}); process.stdout.write(String(marker.hasSeenPasskeyEnrollment()));`,
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "false");
});

test("writes only the nonsecret sticky marker", () => {
  const writes: Array<[string, string]> = [];
  const storage: TestStorage = {
    getItem: (key) =>
      writes.find(([storedKey]) => storedKey === key)?.[1] ?? null,
    setItem: (key, value) => writes.push([key, value]),
  };

  assert.equal(rememberPasskeyEnrollment(storage), true);
  assert.deepEqual(writes, [["passkey_enrollment_seen_v1", "1"]]);
  assert.equal(hasSeenPasskeyEnrollment(storage), true);
});

test("write failures are reported without throwing", () => {
  assert.equal(rememberPasskeyEnrollment(null), false);
  assert.equal(
    rememberPasskeyEnrollment({
      getItem: () => null,
      setItem: () => {
        throw new Error("storage blocked");
      },
    }),
    false
  );
});

test("marker module provides no clear or delete operation", async () => {
  const marker = await import("../src/lib/passkey-enrollment-state");

  assert.equal("clearPasskeyEnrollment" in marker, false);
  assert.equal("forgetPasskeyEnrollment" in marker, false);
  assert.equal("deletePasskeyEnrollment" in marker, false);
});
