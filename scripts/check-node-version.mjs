const [major, minor, patch] = process.versions.node.split(".").map(Number);

const supported = major >= 20 && major < 24;

if (supported) {
  process.exit(0);
}

const version = [major, minor, patch].filter((value) => Number.isFinite(value)).join(".");

console.error(
  [
    `Unsupported Node.js version: ${version}.`,
    "Use Node.js 20 or 22 for this project.",
    "If you use nvm, run `nvm use` after installing the version from `.nvmrc`.",
  ].join("\n"),
);

process.exit(1);
