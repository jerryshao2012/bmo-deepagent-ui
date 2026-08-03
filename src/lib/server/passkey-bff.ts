const MAX_JSON_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE_NAME = "session_token";
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

interface ForwardOptions {
  requiresSession?: boolean;
  requiresOrigin?: boolean;
  jsonBody?: "authentication" | "registration" | "label";
  issueSession?: boolean;
}

interface PasskeyBffConfig {
  backendUrl: string;
  origin: string;
  proxyId: string;
  proxySecret: string;
}

type BodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; response: Response };

type JsonBodyResult =
  | { ok: true; body: string }
  | { ok: false; response: Response };

function errorResponse(status: number, code: string) {
  const response = Response.json({ code }, { status });
  response.headers.set("cache-control", "no-store");
  return response;
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(
    (value || "").trim().toLowerCase()
  );
}

function headerSafeAscii(value: string) {
  return value.length > 0 && !/[^\x20-\x7e]/.test(value);
}

function isIpv4Loopback(hostname: string) {
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

function readConfig(): PasskeyBffConfig | null {
  const origin = process.env.PASSKEY_ORIGIN?.trim();
  const rawProxyId = process.env.PASSKEY_PROXY_ID || "";
  const proxyId = rawProxyId.trim();
  const proxySecret = process.env.PASSKEY_PROXY_SECRET || "";
  const backendUrl = (
    process.env.LANGGRAPH_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_URL ||
    "http://localhost:2024"
  ).replace(/\/+$/, "");

  if (
    !enabled(process.env.PASSKEY_ENABLED) ||
    !origin ||
    origin.length > 2_048 ||
    !headerSafeAscii(rawProxyId) ||
    !proxyId ||
    proxyId.length > 255 ||
    !headerSafeAscii(proxySecret) ||
    proxySecret.trim() !== proxySecret
  ) {
    return null;
  }

  const secretLength = new TextEncoder().encode(proxySecret).byteLength;
  if (secretLength < 32 || secretLength > 4_096) return null;

  try {
    const parsedOrigin = new URL(origin);
    const isLocalhost =
      parsedOrigin.hostname === "localhost" ||
      parsedOrigin.hostname.endsWith(".localhost") ||
      isIpv4Loopback(parsedOrigin.hostname) ||
      parsedOrigin.hostname === "[::1]";
    if (
      ![parsedOrigin.origin, `${parsedOrigin.origin}/`].includes(origin) ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      (parsedOrigin.protocol !== "https:" && !isLocalhost)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    backendUrl,
    origin: new URL(origin).origin,
    proxyId,
    proxySecret,
  };
}

export function isPasskeyBffConfigured() {
  return readConfig() !== null;
}

function getCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function base64Url(value: unknown, maxLength = MAX_JSON_BODY_BYTES) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function isPasskeyCredentialId(value: unknown) {
  return base64Url(value, 2_048);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function normalizedLabel(value: unknown, required: boolean) {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) return null;
  const label = value.trim();
  if ((required && !label) || Array.from(label).length > 100) return null;
  return label;
}

function validWebAuthnResponse(
  value: unknown,
  kind: "authentication" | "registration"
) {
  if (!record(value) || !record(value.response)) return false;
  if (
    !isPasskeyCredentialId(value.id) ||
    !isPasskeyCredentialId(value.rawId) ||
    value.id !== value.rawId ||
    value.type !== "public-key" ||
    !record(value.clientExtensionResults) ||
    !base64Url(value.response.clientDataJSON)
  ) {
    return false;
  }

  if (kind === "registration") {
    return base64Url(value.response.attestationObject);
  }
  return (
    base64Url(value.response.authenticatorData) &&
    base64Url(value.response.signature) &&
    base64Url(value.response.userHandle, 2_048)
  );
}

function validJsonPayload(
  value: unknown,
  schema: "authentication" | "registration" | "label"
) {
  if (!record(value)) return false;
  if (schema === "label") {
    const label = normalizedLabel(value.label, true);
    if (!label) return false;
    value.label = label;
    return true;
  }
  if (!base64Url(value.ceremony_id, 128)) return false;
  if (!validWebAuthnResponse(value.response, schema)) return false;
  if (schema !== "registration") return true;
  if (value.label === undefined || value.label === null) {
    delete value.label;
    return true;
  }
  const label = normalizedLabel(value.label, false);
  if (label === null) return false;
  if (label) value.label = label;
  else delete value.label;
  return true;
}

async function readBodyWithLimit(request: Request): Promise<BodyReadResult> {
  if (!request.body) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          response: errorResponse(413, "payload_too_large"),
        };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_payload") };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

async function readJsonBody(
  request: Request,
  schema: "authentication" | "registration" | "label"
): Promise<JsonBodyResult> {
  const mediaType = (request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: errorResponse(415, "unsupported_media_type"),
    };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return { ok: false, response: errorResponse(400, "invalid_payload") };
    }
    if (Number(contentLength) > MAX_JSON_BODY_BYTES) {
      return {
        ok: false,
        response: errorResponse(413, "payload_too_large"),
      };
    }
  }

  const result = await readBodyWithLimit(request);
  if (!result.ok) return result;

  try {
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(
      result.bytes
    );
    const value: unknown = JSON.parse(rawBody);
    if (!validJsonPayload(value, schema)) {
      return { ok: false, response: errorResponse(400, "invalid_payload") };
    }
    return { ok: true, body: JSON.stringify(value) };
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_payload") };
  }
}

function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    token
  )}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

async function passThrough(response: Response) {
  const body = await response.text();
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  return new Response(body, { status: response.status, headers });
}

async function passThroughAuthenticationError(response: Response) {
  try {
    const result: unknown = await response.json();
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const safeResult = { ...(result as Record<string, unknown>) };
      delete safeResult.session_token;
      delete safeResult.token;
      const safeResponse = Response.json(safeResult, {
        status: response.status,
      });
      safeResponse.headers.set("cache-control", "no-store");
      return safeResponse;
    }
  } catch {
    // Authentication errors are deliberately replaced with a generic body.
  }
  return errorResponse(response.status, "authentication_failed");
}

export async function forwardPasskeyRequest(
  request: Request,
  backendPath: string,
  options: ForwardOptions = {}
) {
  const config = readConfig();
  if (!config) return errorResponse(503, "passkeys_unavailable");
  if (
    options.requiresOrigin &&
    request.headers.get("origin") !== config.origin
  ) {
    return errorResponse(403, "invalid_request_origin");
  }

  const headers = new Headers({
    accept: "application/json",
    "x-passkey-origin": config.origin,
    "x-passkey-proxy-id": config.proxyId,
    "x-passkey-proxy-secret": config.proxySecret,
  });

  if (options.requiresSession) {
    const token = getCookie(request, SESSION_COOKIE_NAME);
    if (!token) return errorResponse(401, "authentication_required");
    headers.set("authorization", `Bearer ${token}`);
  }

  let body: string | undefined;
  if (options.jsonBody) {
    const result = await readJsonBody(request, options.jsonBody);
    if (!result.ok) return result.response;
    body = result.body;
    headers.set("content-type", "application/json");
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${config.backendUrl}${backendPath}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return errorResponse(502, "authentication_service_unavailable");
  }

  if (options.issueSession && !backendResponse.ok) {
    return passThroughAuthenticationError(backendResponse);
  }
  if (!options.issueSession) {
    return passThrough(backendResponse);
  }

  let result: unknown;
  try {
    result = await backendResponse.json();
  } catch {
    return errorResponse(502, "invalid_authentication_response");
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return errorResponse(502, "invalid_authentication_response");
  }

  const { session_token: token, user } = result as Record<string, unknown>;
  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > 4096 ||
    !/^[A-Za-z0-9._~-]+$/.test(token) ||
    !user ||
    typeof user !== "object" ||
    Array.isArray(user)
  ) {
    return errorResponse(502, "invalid_authentication_response");
  }

  const response = Response.json({ ok: true, user });
  response.headers.set("cache-control", "no-store");
  response.headers.set("set-cookie", sessionCookie(token));
  return response;
}
