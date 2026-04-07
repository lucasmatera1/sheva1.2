/**
 * Post-build script: adds .js extensions to all relative imports in dist/
 * Required because tsconfig uses moduleResolution: "Bundler" which omits extensions,
 * but Node.js ESM requires them.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(__dirname, "..", "dist");

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (extname(entry.name) === ".js") yield full;
  }
}

// Match relative imports/exports and dynamic imports that lack .js
const staticRe = /((?:from|export\s*\*\s*from)\s+['"])(\.\.?\/[^'"]*?)(?<!\.js)(['"])/g;
const dynamicRe = /(import\s*\(\s*['"])(\.\.?\/[^'"]*?)(?<!\.js)(['"]\s*\))/g;
const sideEffectRe = /(import\s+['"])(\.\.?\/[^'"]*?)(?<!\.js)(['"])/g;

let fixed = 0;
for await (const filePath of walk(distDir)) {
  const content = await readFile(filePath, "utf8");
  const replaced = content
    .replace(staticRe, "$1$2.js$3")
    .replace(dynamicRe, "$1$2.js$3")
    .replace(sideEffectRe, "$1$2.js$3");
  if (replaced !== content) {
    await writeFile(filePath, replaced, "utf8");
    fixed++;
  }
}

console.log(`fix-esm-imports: ${fixed} files patched`);
