import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/iturban/Development/OmniRoute";
const routePath = join(ROOT, "src/app/api/v1/rerank/route.ts");

test("rerank route should use shared CORS headers helper, not removed CORS_ORIGIN export", () => {
  const src = readFileSync(routePath, "utf8");
  assert.doesNotMatch(
    src,
    /import\s*\{\s*CORS_ORIGIN\s*\}\s*from\s*["']@\/shared\/utils\/cors["']/
  );
  assert.match(src, /from\s*["']@\/shared\/utils\/cors["']/);
  assert.match(src, /CORS_HEADERS|handleCorsOptions/);
});
