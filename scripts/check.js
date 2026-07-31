"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jsonFiles = ["package.json", "manifest.json", "manifests/firefox/manifest.json"];
const jsFiles = [
  "src/extension/config.js",
  "src/extension/background.js",
  "src/extension/content-youtube.js",
  "src/extension/content-soundcloud.js",
  "src/extension/content-generic.js",
  "src/extension/popup.js",
  "scripts/build-firefox.js",
  "scripts/package-extension.js"
];

for (const file of jsonFiles) {
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  console.log(`json ok: ${file}`);
}

for (const file of jsFiles) {
  require("node:child_process").execFileSync(process.execPath, ["--check", path.join(root, file)], {
    stdio: "inherit"
  });
  console.log(`js ok: ${file}`);
}
