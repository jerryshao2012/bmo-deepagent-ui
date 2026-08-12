export const PASSKEY_ENROLLMENT_MARKER_KEY =
  "passkey_enrollment_seen_v1" as const;

export type PasskeyEnrollmentStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PasskeyEnrollmentStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasSeenPasskeyEnrollment(
  storage?: PasskeyEnrollmentStorage | null
): boolean {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return false;

  try {
    return target.getItem(PASSKEY_ENROLLMENT_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPasskeyEnrollment(
  storage?: PasskeyEnrollmentStorage | null
): boolean {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return false;

  try {
    target.setItem(PASSKEY_ENROLLMENT_MARKER_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
