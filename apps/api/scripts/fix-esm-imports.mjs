/**
 * Post-build script: adds .js extensions to all relative imports in dist/
 * Required because tsconfig uses moduleResolution: "Bundler" which omits extensions,
 * but Node.js ESM requires them.
 *
 * Handles:
 *  - file imports: ./foo  → ./foo.js
 *  - directory imports: ./foo  → ./foo/index.js  (when foo/ exists with index.js)
 *  - side-effect imports: import "./foo"
 *  - re-exports: export * from "./foo"
 *  - dynamic imports: import("./foo")
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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

/**
 * Given a specifier like ./core/analytics and the file that imports it,
 * return the correct specifier with .js or /index.js.
 */
function resolveSpecifier(spec, fromFile) {
  if (spec.endsWith(".js")) return spec;

  const baseDir = dirname(fromFile);
  const targetAsFile = join(baseDir, spec + ".js");
  const targetAsDir = join(baseDir, spec, "index.js");

  if (existsSync(targetAsFile)) return spec + ".js";
  if (existsSync(targetAsDir)) return spec + "/index.js";

  // Fallback: add .js and hope for the best
  return spec + ".js";
}

// Matches relative specifiers in static/dynamic imports/exports
const specRe = /((?:from|import|export\s*\*\s*from)\s*['"]|import\s*\(\s*['"])(\.\.?\/[^'"]*?)(['"])/g;

let fixed = 0;
for await (const filePath of walk(distDir)) {
  const content = await readFile(filePath, "utf8");
  const replaced = content.replace(specRe, (match, prefix, spec, suffix) => {
    if (spec.endsWith(".js")) return match;
    const resolved = resolveSpecifier(spec, filePath);
    return prefix + resolved + suffix;
  });
  if (replaced !== content) {
    await writeFile(filePath, replaced, "utf8");
    fixed++;
  }
}

console.log(`fix-esm-imports: ${fixed} files patched`);
