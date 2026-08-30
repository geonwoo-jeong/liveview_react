import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { DEFAULT_BENCHMARK_OPTIONS } from "./config.mjs";

export function parseArgs(argv) {
  const args = Object.freeze(argv.slice(2));
  const options = {
    workspace: undefined,
    output: undefined,
    offline: false,
    target: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--offline") {
      options.offline = true;
      continue;
    }
    if (arg === "--workspace") {
      options.workspace = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.output = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--target") {
      options.target = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return Object.freeze(options);
}

export function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function safeWriteJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function safeWriteText(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  writeFileSync(filePath, value, "utf8");
}

export function run(command, args, options = {}) {
  const env = {
    ...process.env,
    npm_config_cache: path.join(tmpdir(), "liveview-react-bench-npm-cache"),
    ...options.env,
  };
  const result = execFileSync(command, args, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return typeof result === "string" ? result.trim() : "";
}

export function assertInvariant(condition, message) {
  if (!condition) {
    throw new Error(`Benchmark invariant failed: ${message}`);
  }
}

export function removeIfExists(targetPath) {
  if (existsSync(targetPath))
    rmSync(targetPath, { force: true, recursive: true });
}

export function copyWorkspaceSnapshot(sourceRoot, destinationRoot) {
  removeIfExists(destinationRoot);
  cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    preserveTimestamps: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      if (relative === "") return true;
      const first = relative.split(path.sep)[0];
      return ![
        ".git",
        "_build",
        "deps",
        "dist",
        "node_modules",
        "playwright-report",
        "test-results",
      ].includes(first);
    },
  });
}

export function ensureSymlink(linkPath, targetPath) {
  if (existsSync(linkPath) || lstatExists(linkPath)) removeIfExists(linkPath);
  symlinkSync(targetPath, linkPath, "junction");
}

function lstatExists(targetPath) {
  try {
    lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function exportGitTree(repositoryRoot, revision, destinationRoot) {
  removeIfExists(destinationRoot);
  ensureDirectory(destinationRoot);
  const archivePath = path.join(destinationRoot, "..", `${revision}.tar`);
  removeIfExists(archivePath);
  run("git", [
    "-C",
    repositoryRoot,
    "archive",
    "--format=tar",
    "-o",
    archivePath,
    revision,
  ]);
  run("tar", ["-xf", archivePath, "-C", destinationRoot]);
  removeIfExists(archivePath);
}

export function extractTarball(tarballPath, destinationRoot) {
  removeIfExists(destinationRoot);
  ensureDirectory(destinationRoot);
  run("tar", ["-xf", tarballPath, "-C", destinationRoot]);
}

export function fileSize(filePath) {
  return statSync(filePath).size;
}

export function directoryFileCount(directory) {
  if (!existsSync(directory)) return 0;
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += directoryFileCount(fullPath);
    if (entry.isFile()) count += 1;
  }
  return count;
}

export function directoryByteSize(directory) {
  if (!existsSync(directory)) return 0;
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directoryByteSize(fullPath);
    if (entry.isFile()) total += statSync(fullPath).size;
  }
  return total;
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function nowIso() {
  return new Date().toISOString();
}

export function resolveRealPath(filePath) {
  return realpathSync(filePath);
}

export function parseNpmPackJson(stdout) {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") || line.startsWith("{"));
  assertInvariant(lines.length > 0, "npm pack --json produced no JSON payload");
  const payload = JSON.parse(lines.at(-1));
  return Array.isArray(payload) ? payload[0] : payload;
}

export function summarizeSeries(values) {
  assertInvariant(values.length > 0, "timing series must not be empty");
  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;
  const percentile = (ratio) => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * ratio)),
    );
    return sorted[index];
  };

  return Object.freeze({
    maxMs: sorted.at(-1),
    meanMs: mean,
    minMs: sorted[0],
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    samples: values.length,
    standardDeviationMs: Math.sqrt(variance),
    varianceMs2: variance,
  });
}

export async function measureCase({
  batch,
  iterationsPerSample,
  name,
  samples = DEFAULT_BENCHMARK_OPTIONS.samples,
  warmupSamples = DEFAULT_BENCHMARK_OPTIONS.warmupSamples,
}) {
  for (let index = 0; index < warmupSamples; index += 1) {
    await batch();
  }

  const sampleDurations = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    await batch();
    sampleDurations.push(performance.now() - startedAt);
  }

  const summary = summarizeSeries(sampleDurations);
  return Object.freeze({
    iterationsPerSample,
    name,
    samples,
    sampleDurationsMs: sampleDurations,
    summary: Object.freeze({
      ...summary,
      hz: (iterationsPerSample * 1000) / summary.meanMs,
      perIterationMs: summary.meanMs / iterationsPerSample,
      relativeMargin:
        summary.meanMs === 0 ? 0 : summary.standardDeviationMs / summary.meanMs,
    }),
    warmupSamples,
  });
}
