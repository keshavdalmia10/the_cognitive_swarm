import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        return [entryPath];
      }
      return [];
    }),
  );

  return files.flat().sort();
}

const userArgs = process.argv.slice(2);
const defaultTestFiles = userArgs.length > 0 ? [] : await collectTestFiles(path.resolve("tests"));
const testArgs = userArgs.length > 0 ? userArgs : defaultTestFiles;

if (testArgs.length === 0) {
  console.error("No test files found.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import=tsx", "--test", ...testArgs], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
