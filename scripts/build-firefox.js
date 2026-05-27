"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist", "firefox");

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function removeDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

removeDir(out);
copyFile(path.join(root, "manifests", "firefox", "manifest.json"), path.join(out, "manifest.json"));

for (const file of ["config.js", "background.js", "content-youtube.js", "content-soundcloud.js", "popup.html", "popup.css", "popup.js"]) {
  copyFile(path.join(root, "src", "extension", file), path.join(out, "src", "extension", file));
}

console.log(`Built Firefox extension in ${out}`);
