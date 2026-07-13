import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("identifies Atlas as a Digital Threads project", async () => {
  const [packageText, readme] = await Promise.all([
    read("package.json"),
    read("README.md"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.name, "@dthreads/atlas");
  assert.equal(packageJson.author, "Digital Threads");
  assert.equal(
    packageJson.repository.url,
    "https://github.com/Digital-Threads/atlas.git",
  );
  assert.match(readme, /^# Atlas$/m);
  assert.match(readme, /Architecture intelligence for NestJS codebases/i);
});

test("documents the product status and development workflow", async () => {
  const readme = await read("README.md");

  assert.match(readme, /npm install/);
  assert.match(readme, /npm run dev/);
  assert.match(readme, /npm run check/);
  assert.match(readme, /not yet published/i);
});
