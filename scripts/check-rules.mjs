// CI's rule check: brainhound's code may read and fetch, never write, run programs or reach
// anything but the archives. Run it with: node scripts/check-rules.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { HOSTS } from "../src/net.js";
import { TOOLS } from "../src/mcp.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
};
walk(path.join(root, "src"));

const banned = [
  [/child_process|\bexecSync\b|\bspawn\(/, "runs programs"],
  [/\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|createWriteStream|truncate|chmod|symlink)\w*\(/, "writes to disk"],
  [/\beval\(|new Function\(/, "evaluates code"],
  [/process\.env/, "reads environment variables (keys and tokens live there)"],
  [/["'`]http:\/\//, "uses plain http"],
  [/\bimport\(/, "loads code at run time"],
];
const problems = [];
for (const file of files) {
  const rel = path.relative(root, file);
  const code = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
  for (const [pattern, why] of banned) if (pattern.test(code)) problems.push(`${rel} ${why}: ${pattern}`);
  // Only net.js may call fetch; everything else goes through its host list.
  if (rel !== path.join("src", "net.js") && /\bfetch\(/.test(code)) problems.push(`${rel} calls fetch directly instead of going through src/net.js`);
  // Files are only ever opened for reading.
  for (const m of code.matchAll(/(?:await|=|return)\s+open\(([^)]*)\)/g)) if (!/,\s*"r"\s*$/.test(m[1])) problems.push(`${rel} opens a file in a mode other than "r": open(${m[1]})`);
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) if (pkg[key]) problems.push(`package.json has ${key}; brainhound has none`);
for (const host of HOSTS) if (!/^[a-z0-9.-]+\.(org|com)$/.test(host)) problems.push(`odd host on the allow list: ${host}`);
const security = readFileSync(path.join(root, "SECURITY.md"), "utf8");
for (const host of HOSTS) if (!security.includes(host)) problems.push(`SECURITY.md doesn't list ${host}`);
for (const t of TOOLS) if (t.annotations.readOnlyHint !== true || t.annotations.destructiveHint !== false) problems.push(`tool ${t.name} isn't marked read-only`);

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`OK: ${files.length} source files, no dependencies, ${HOSTS.size} allowed hosts, ${TOOLS.length} read-only tools.`);
