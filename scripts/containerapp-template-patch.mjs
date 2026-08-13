#!/usr/bin/env node

import fs from "node:fs";

const CONTROL = /[\u0000-\u001f\u007f]/;
const isObject = (value) =>
  value !== null && !Array.isArray(value) && typeof value === "object";
const isSafeString = (value) =>
  typeof value === "string" && value.length > 0 && !CONTROL.test(value);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
};

const parseJson = (bytes) => {
  try {
    return JSON.parse(bytes);
  } catch {
    process.exit(2);
  }
};

const validateReadyRevision = (
  snapshot,
  expectedRevisionName,
  targetContainer
) => {
  if (
    !isObject(snapshot) ||
    Object.keys(snapshot).sort().join("|") !== "name|template" ||
    snapshot.name !== expectedRevisionName ||
    !isObject(snapshot.template) ||
    !Array.isArray(snapshot.template.containers)
  ) {
    process.exit(2);
  }
  const targets = snapshot.template.containers.filter(
    (container) => isObject(container) && container.name === targetContainer
  );
  if (targets.length !== 1) process.exit(2);
  return snapshot;
};

const validateEnv = (env) => {
  if (env === undefined) return [];
  if (!Array.isArray(env)) process.exit(2);
  const names = new Set();
  for (const entry of env) {
    if (
      !isObject(entry) ||
      !isSafeString(entry.name) ||
      names.has(entry.name)
    ) {
      process.exit(2);
    }
    names.add(entry.name);
    const hasValue = Object.hasOwn(entry, "value");
    const hasSecretRef = Object.hasOwn(entry, "secretRef");
    if (
      hasValue === hasSecretRef ||
      (hasValue && typeof entry.value !== "string") ||
      (hasSecretRef && !isSafeString(entry.secretRef))
    ) {
      process.exit(2);
    }
  }
  return env;
};

const [mode, ...args] = process.argv.slice(2);

if (mode === "capture") {
  if (args.length !== 4) process.exit(2);
  const [outputPath, location, expectedRevisionName, targetContainer] = args;
  if (!isSafeString(location) || !isSafeString(expectedRevisionName)) {
    process.exit(2);
  }
  const snapshot = validateReadyRevision(
    parseJson(fs.readFileSync(0, "utf8")),
    expectedRevisionName,
    targetContainer
  );
  const baseline = canonicalize({
    location,
    revisionName: snapshot.name,
    template: snapshot.template,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(baseline)}\n`, {
    mode: 0o600,
  });
} else if (mode === "patch") {
  if (args.length !== 8) process.exit(2);
  const [
    baselinePath,
    outputPath,
    targetContainer,
    revisionSuffix,
    image,
    backendUrl,
    assistantId,
    uiUrl,
  ] = args;
  for (const value of [
    targetContainer,
    revisionSuffix,
    image,
    backendUrl,
    assistantId,
    uiUrl,
  ]) {
    if (!isSafeString(value)) process.exit(2);
  }
  const baseline = parseJson(fs.readFileSync(baselinePath, "utf8"));
  if (
    !isObject(baseline) ||
    Object.keys(baseline).sort().join("|") !==
      "location|revisionName|template" ||
    !isSafeString(baseline.location) ||
    !isSafeString(baseline.revisionName) ||
    !isObject(baseline.template)
  ) {
    process.exit(2);
  }
  const template = structuredClone(baseline.template);
  delete template.customMetricsSettings;
  for (const field of ["containers", "initContainers"]) {
    if (template[field] === undefined || template[field] === null) continue;
    if (!Array.isArray(template[field])) process.exit(2);
    for (const item of template[field]) {
      if (!isObject(item)) process.exit(2);
      delete item.imageType;
    }
  }
  const containers = template.containers.filter(
    (container) => isObject(container) && container.name === targetContainer
  );
  if (containers.length !== 1) process.exit(2);
  const container = containers[0];
  const owned = new Set([
    "NEXT_TELEMETRY_DISABLED",
    "NEXT_PUBLIC_LANGGRAPH_URL",
    "BACKEND_API_URL",
    "NEXT_PUBLIC_ASSISTANT_ID",
    "AUTH_URL",
    "NEXTAUTH_URL",
    "AUTH_TRUST_HOST",
    "NODE_ENV",
    "UPLOAD_API_KEY",
    "PASSKEY_ENABLED",
    "PASSKEY_ORIGIN",
    "PASSKEY_PROXY_ID",
    "PASSKEY_PROXY_SECRET",
  ]);
  container.env = validateEnv(container.env).filter(
    (entry) => !owned.has(entry.name)
  );
  container.env.push(
    { name: "NEXT_TELEMETRY_DISABLED", value: "1" },
    { name: "NEXT_PUBLIC_LANGGRAPH_URL", value: backendUrl },
    { name: "BACKEND_API_URL", value: backendUrl },
    { name: "NEXT_PUBLIC_ASSISTANT_ID", value: assistantId },
    { name: "AUTH_URL", value: uiUrl },
    { name: "NEXTAUTH_URL", value: uiUrl },
    { name: "AUTH_TRUST_HOST", value: "true" },
    { name: "NODE_ENV", value: "production" },
    { name: "UPLOAD_API_KEY", secretRef: "upload-api-key" },
    { name: "PASSKEY_ENABLED", value: "true" },
    { name: "PASSKEY_ORIGIN", value: uiUrl },
    { name: "PASSKEY_PROXY_ID", value: "web-bff" },
    { name: "PASSKEY_PROXY_SECRET", secretRef: "passkey-proxy-secret" }
  );
  container.image = image;
  template.revisionSuffix = revisionSuffix;
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify({
      location: baseline.location,
      properties: { template },
    })}\n`,
    { mode: 0o600 }
  );
} else {
  process.exit(2);
}
