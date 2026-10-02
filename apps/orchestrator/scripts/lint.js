import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["index.js", "src"];

function collect(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collect(full));
    } else if (entry.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const files = ["index.js"];
for (const root of roots) {
  if (root === "index.js") continue;
  files.push(...collect(root));
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  } catch {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`lint failed: ${failed} file(s) with syntax errors`);
  process.exit(1);
}
console.log(`lint ok: ${files.length} files checked`);
