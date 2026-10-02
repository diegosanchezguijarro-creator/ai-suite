import fs from "node:fs";
import path from "node:path";

const skip = new Set(["node_modules", ".git", ".env", ".oc-models.json"]);
const pats = [
  /oc_sk_[A-Za-z0-9_-]{20,}/g,
  /st_[A-Za-z0-9-]{25,}/g,
  /sk-[A-Za-z0-9_-]{30,}/g,
  /api[_-]?key["']?\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/gi,
  /Bearer\s+[A-Za-z0-9._-]{25,}/g,
];

let found = 0;
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else {
      const t = fs.readFileSync(p, "latin1");
      for (const re of pats) {
        for (const m of t.match(re) || []) {
          found += 1;
          console.log("HIT", p, m.slice(0, 16));
        }
      }
    }
  }
}

walk(process.cwd());
console.log(found === 0 ? "CLEAN: no secrets in committable files" : `FOUND ${found}`);
process.exit(found === 0 ? 0 : 1);
