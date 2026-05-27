"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const packages = path.join(dist, "packages");
const targets = new Set(["chromium", "firefox"]);

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else copyFile(source, target);
  }
}

function removeDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function buildTarget(target) {
  const out = path.join(dist, target);
  removeDir(out);

  const manifest = target === "firefox"
    ? path.join(root, "manifests", "firefox", "manifest.json")
    : path.join(root, "manifest.json");

  copyFile(manifest, path.join(out, "manifest.json"));
  copyFile(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
  copyFile(path.join(root, "PRIVACY.md"), path.join(out, "PRIVACY.md"));

  for (const file of ["config.js", "background.js", "content-youtube.js", "content-soundcloud.js", "popup.html", "popup.css", "popup.js"]) {
    copyFile(path.join(root, "src", "extension", file), path.join(out, "src", "extension", file));
  }

  copyDir(path.join(root, "icons"), path.join(out, "icons"));
  return out;
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, base).map((file) => file.absolute));
    else files.push(fullPath);
  }
  return files.sort().map((file) => ({
    absolute: file,
    relative: path.relative(base, file).replace(/\\/g, "/")
  }));
}

function writeZip(sourceDir, zipFile) {
  fs.mkdirSync(path.dirname(zipFile), { recursive: true });
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of listFiles(sourceDir)) {
    const data = fs.readFileSync(file.absolute);
    const name = Buffer.from(file.relative, "utf8");
    const stat = fs.statSync(file.absolute);
    const { dosDate, dosTime } = dosDateTime(stat.mtime);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralParts.length / 2, 8);
  end.writeUInt16LE(centralParts.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(zipFile, Buffer.concat([...localParts, ...centralParts, end]));
}

function packageTarget(target) {
  const out = buildTarget(target);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  const zipFile = path.join(packages, `${target}-${manifest.version}.zip`);
  writeZip(out, zipFile);
  console.log(`Built ${target}: ${out}`);
  console.log(`Wrote ${zipFile}`);
}

const requested = process.argv[2] || "all";
const selected = requested === "all" ? [...targets] : [requested];

for (const target of selected) {
  if (!targets.has(target)) {
    console.error("Usage: node scripts/package-extension.js [all|chromium|firefox]");
    process.exit(1);
  }
  packageTarget(target);
}
