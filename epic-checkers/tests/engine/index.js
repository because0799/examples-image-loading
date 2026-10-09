// Entry point for `node --test tests/engine/` — on Node 22 a directory argument is resolved like a
// module (→ this index.js) instead of being scanned, so load every *.test.js of this directory.
// (`node --test "tests/engine/*.test.js"` runs the same files in parallel processes.)
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
for (const f of readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort()) {
  await import(new URL(f, import.meta.url));
}
