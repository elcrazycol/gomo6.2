// Idempotent postinstall patch for vaul 0.9.x.
//
// vaul blocks ALL drags for 500ms after the drawer opens (openTime ref set in
// an effect on isOpen, consumed in shouldDrag) to avoid accidental drags while
// the open animation plays. With handleOnly the handle is the only drag target,
// so this window makes the handle dead right after opening the channel sheet —
// you have to wait/tap around until the 500ms pass.
//
// Fix: in shouldDrag, skip the open-animation block when the pointer is on the
// handle ([data-vaul-handle]) — grabbing the handle is never accidental.
//
// Must be idempotent (npm postinstall runs on every install) and fail loudly
// if the target snippet is gone (vaul upgraded -> re-check the patch).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(repoRoot, "node_modules", "vaul", "dist", "index.mjs");

const TARGET = `        if (openTime.current && date.getTime() - openTime.current.getTime() < 500) {`;
const REPLACEMENT = `        if (openTime.current && date.getTime() - openTime.current.getTime() < 500 && !element.closest('[data-vaul-handle]')) {`;

if (!existsSync(file)) {
  console.warn("[patch-vaul] vaul not installed, skipping");
  process.exit(0);
}

const src = readFileSync(file, "utf8");

if (src.includes(REPLACEMENT)) {
  console.log("[patch-vaul] already applied, skipping");
  process.exit(0);
}

if (!src.includes(TARGET)) {
  console.error(
    "[patch-vaul] target snippet not found in " + file + " — vaul was upgraded or changed; update scripts/patch-vaul.mjs",
  );
  process.exit(1);
}

writeFileSync(file, src.replace(TARGET, REPLACEMENT), "utf8");
console.log("[patch-vaul] applied: handle drags are no longer blocked 500ms after open");
