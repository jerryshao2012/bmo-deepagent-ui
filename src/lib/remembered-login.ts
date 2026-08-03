export const REMEMBERED_LOGIN_KEY = "remembered_login_v1";
export const LEGACY_LAST_USED_PROVIDER_KEY = "last_used_provider";

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_AVATAR_URL_LENGTH = 2048;

export type LoginProvider = "google" | "github";

export function isLoginProvider(value: unknown): value is LoginProvider {
  return value === "google" || value === "github";
}

export interface RememberedLogin {
  version: 1;
  provider: LoginProvider;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface RememberedLoginCandidate {
  provider?: unknown;
  name?: unknown;
  email?: unknown;
  avatarUrl?: unknown;
  image?: unknown;
}

export interface AuthenticatedUser {
  identity: string;
  provider: string;
  auth_method?: "oauth" | "passkey";
  name: string | null;
  email: string | null;
  image: string | null;
}

export type RememberedLoginStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function browserStorage(): RememberedLoginStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;

  return normalized;
}

function normalizeAvatarUrl(value: unknown): string | null {
  const normalized = normalizeText(value, MAX_AVATAR_URL_LENGTH);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeProvider(value: unknown): LoginProvider | null {
  return isLoginProvider(value) ? value : null;
}

function normalizeCandidate(
  value: unknown,
  requireVersion: boolean
): RememberedLogin | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as RememberedLoginCandidate & { version?: unknown };
  if (requireVersion && candidate.version !== 1) return null;

  const provider = normalizeProvider(candidate.provider);
  const name = normalizeText(candidate.name, MAX_NAME_LENGTH);
  const email = normalizeText(candidate.email, MAX_EMAIL_LENGTH);

  if (!provider || (!name && !email)) return null;

  return {
    version: 1,
    provider,
    name,
    email,
    avatarUrl: normalizeAvatarUrl(candidate.avatarUrl ?? candidate.image),
  };
}

function safeRemove(storage: RememberedLoginStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Browser storage may be unavailable or blocked. Remembered login is optional.
  }
}

export function readRememberedLogin(
  storage: RememberedLoginStorage | null = browserStorage()
): RememberedLogin | null {
  if (!storage) return null;

  safeRemove(storage, LEGACY_LAST_USED_PROVIDER_KEY);

  try {
    const serialized = storage.getItem(REMEMBERED_LOGIN_KEY);
    if (!serialized) return null;

    const remembered = normalizeCandidate(JSON.parse(serialized), true);
    if (!remembered) safeRemove(storage, REMEMBERED_LOGIN_KEY);

    return remembered;
  } catch {
    safeRemove(storage, REMEMBERED_LOGIN_KEY);
    return null;
  }
}

export function writeRememberedLogin(
  candidate: RememberedLoginCandidate,
  storage: RememberedLoginStorage | null = browserStorage()
): RememberedLogin | null {
  if (!storage) return null;

  safeRemove(storage, LEGACY_LAST_USED_PROVIDER_KEY);

  const remembered = normalizeCandidate(candidate, false);
  if (!remembered) return null;

  try {
    storage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify(remembered));
    return remembered;
  } catch {
    return null;
  }
}

export function clearRememberedLogin(
  storage: RememberedLoginStorage | null = browserStorage()
) {
  if (!storage) return;

  safeRemove(storage, REMEMBERED_LOGIN_KEY);
  safeRemove(storage, LEGACY_LAST_USED_PROVIDER_KEY);
}
