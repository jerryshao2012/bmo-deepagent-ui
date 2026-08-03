#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const FRAMEWORK_IMPORTS = [
  "react",
  "next",
  "@langchain/",
  "swr",
  "nuqs",
  "sonner",
  "lucide-react",
];

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(target)
        : Promise.resolve(
            SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [target] : [],
          );
    }),
  );
  return nested.flat();
};

const importSpecifiers = (source) => {
  const specifiers = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
};

const featureLayer = (relativePath) => {
  const match = relativePath.match(
    /^src\/features\/([^/]+)\/(domain|application|ui|infrastructure)(?:\/|$)/,
  );
  return match ? { feature: match[1], layer: match[2] } : null;
};

const isFrameworkImport = (specifier) =>
  FRAMEWORK_IMPORTS.some(
    (framework) =>
      specifier === framework ||
      (framework.endsWith("/") && specifier.startsWith(framework)),
  );

const resolveLocalImport = (specifier, importer, rootDir, knownFiles) => {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(rootDir, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => knownFiles.has(path.resolve(candidate))) ?? null;
};

const cycleViolations = (graph, rootDir) => {
  const state = new Map();
  const stack = [];
  const cycles = new Set();

  const visit = (node) => {
    state.set(node, "visiting");
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      if (state.get(dependency) === "visiting") {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency]
          .map((file) => path.relative(rootDir, file).split(path.sep).join("/"))
          .join(" -> ");
        cycles.add(cycle);
      } else if (!state.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(node, "visited");
  };

  for (const node of graph.keys()) {
    if (!state.has(node)) visit(node);
  }
  return [...cycles].map((cycle) => ({ rule: "dependency-cycle", detail: cycle }));
};

export async function checkArchitecture({ rootDir = process.cwd() } = {}) {
  const files = await sourceFiles(path.join(rootDir, "src"));
  const knownFiles = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  const violations = [];

  for (const file of files) {
    const relativePath = path.relative(rootDir, file).split(path.sep).join("/");
    const owner = featureLayer(relativePath);
    const imports = importSpecifiers(await readFile(file, "utf8"));
    const dependencies = [];

    for (const specifier of imports) {
      if (owner?.layer === "domain" && isFrameworkImport(specifier)) {
        violations.push({
          rule: "domain-framework-import",
          file: relativePath,
          detail: specifier,
        });
      }

      const crossFeature = specifier.match(/^@\/features\/([^/]+)(?:\/(.+))?$/);
      if (
        owner &&
        crossFeature &&
        crossFeature[1] !== owner.feature &&
        crossFeature[2]
      ) {
        violations.push({
          rule: "cross-feature-internal-import",
          file: relativePath,
          detail: specifier,
        });
      }

      const resolved = resolveLocalImport(specifier, file, rootDir, knownFiles);
      if (!resolved) continue;
      dependencies.push(path.resolve(resolved));

      const target = featureLayer(
        path.relative(rootDir, resolved).split(path.sep).join("/"),
      );
      if (
        owner?.layer === "application" &&
        target?.feature === owner.feature &&
        ["ui", "infrastructure"].includes(target.layer)
      ) {
        violations.push({
          rule: "application-outward-import",
          file: relativePath,
          detail: specifier,
        });
      }
      if (
        owner?.layer === "domain" &&
        target?.feature === owner.feature &&
        target.layer !== "domain"
      ) {
        violations.push({
          rule: "domain-outward-import",
          file: relativePath,
          detail: specifier,
        });
      }
    }
    graph.set(path.resolve(file), dependencies);
  }

  return [...violations, ...cycleViolations(graph, rootDir)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkArchitecture();
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.rule}: ${violation.file ?? violation.detail}: ${violation.detail}`);
    }
    process.exitCode = 1;
  }
}
