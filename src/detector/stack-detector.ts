import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DetectedStack, ScannedFile } from "../core/types.js";

export async function detectStacks(projectRoot: string, files: ScannedFile[]): Promise<DetectedStack[]> {
  const evidence: string[] = [];
  let score = 0;
  const packageFile = files.find((file) => file.path === "package.json");
  if (packageFile) {
    try {
      const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      for (const name of ["@nestjs/core", "@nestjs/common", "@nestjs/platform-express"]) {
        if (dependencies[name]) {
          evidence.push(`package.json contains ${name}`);
          score += name === "@nestjs/core" ? 0.3 : 0.15;
        }
      }
    } catch {
      evidence.push("package.json exists but could not be parsed");
    }
  }
  for (const [path, weight] of [["nest-cli.json", 0.1], ["src/main.ts", 0.05], ["src/app.module.ts", 0.1]] as const) {
    if (files.some((file) => file.path === path)) {
      evidence.push(`${path} exists`);
      score += weight;
    }
  }
  const sampleFiles = files.filter((file) => file.extension === ".ts").slice(0, 200);
  const texts = await Promise.all(sampleFiles.map((file) => readFile(file.absolutePath, "utf8").catch(() => "")));
  if (texts.some((text) => /@Module\s*\(/.test(text))) {
    evidence.push("found @Module decorator");
    score += 0.1;
  }
  if (texts.some((text) => /@Controller\s*\(/.test(text))) {
    evidence.push("found @Controller decorator");
    score += 0.05;
  }
  if (texts.some((text) => /@Injectable\s*\(/.test(text))) {
    evidence.push("found @Injectable decorator");
    score += 0.05;
  }
  return score > 0
    ? [{ name: "nestjs", confidence: Math.min(1, Number(score.toFixed(2))), evidence }]
    : [];
}
