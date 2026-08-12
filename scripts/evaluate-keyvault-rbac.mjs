#!/usr/bin/env node

const SECRET_READ_ACTIONS = [
  "Microsoft.KeyVault/vaults/secrets/read",
  "Microsoft.KeyVault/vaults/secrets/get",
];
const MAX_INPUT_BYTES = 1024 * 1024;

const fail = () => {
  process.stderr.write("Error: invalid role definition response.\n");
  process.exitCode = 2;
};

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isActionList = (value) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0);

const actionMatches = (pattern, action) => {
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${expression}$`, "i").test(action);
};

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    process.stdin.destroy(new Error("input limit exceeded"));
  }
});

process.stdin.on("error", fail);
process.stdin.on("end", () => {
  try {
    const roles = JSON.parse(input);
    if (roles.length === 0 || !Array.isArray(roles)) throw new Error("roles");

    let hasSecretRead = false;
    for (const role of roles) {
      if (!isObject(role) || !Array.isArray(role.permissions))
        throw new Error("role");
      if (role.permissions.length === 0) throw new Error("permissions");

      const dataActions = [];
      const notDataActions = [];
      for (const permission of role.permissions) {
        if (
          !isObject(permission) ||
          !isActionList(permission.actions) ||
          !isActionList(permission.notActions) ||
          !isActionList(permission.dataActions) ||
          !isActionList(permission.notDataActions)
        ) {
          throw new Error("permission");
        }
        dataActions.push(...permission.dataActions);
        notDataActions.push(...permission.notDataActions);
      }

      const granted = SECRET_READ_ACTIONS.some((action) =>
        dataActions.some((pattern) => actionMatches(pattern, action))
      );
      const excluded = SECRET_READ_ACTIONS.some((action) =>
        notDataActions.some((pattern) => actionMatches(pattern, action))
      );
      if (granted && !excluded) {
        hasSecretRead = true;
      }
    }

    process.stdout.write(`${hasSecretRead}\n`);
  } catch {
    fail();
  }
});
