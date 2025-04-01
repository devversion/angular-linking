import linkerBabelPlugin from "@angular/compiler-cli/linker/babel";
import { transformAsync } from "@babel/core";
import assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

async function main() {
  const fesmBundles = globSync("fesm2022/**/*.mjs");
  const tasks = [];
  /** @type {import('@babel/core').TransformOptions} */
  const babelOptions = {
    plugins: [[linkerBabelPlugin, {}]],
    configFile: false,
    babelrc: false,
  };

  for (const bundleFile of fesmBundles) {
    tasks.push(
      (async () => {
        const content = await readFile(bundleFile, "utf8");
        const result = await transformAsync(content, {
          ...babelOptions,
          filename: bundleFile,
        });

        await writeFile(`${bundleFile}.linked.mjs`, result.code);
      })(),
    );
  }

  tasks.push(
    (async () => {
      const packageJsonRaw = await readFile("package.json", "utf8");
      const packageJson = JSON.parse(packageJsonRaw);

      assert(
        packageJson.exports,
        "No `package.json` `exports` for package. Cannot link Angular code",
      );

      for (const [subpath, conditions] of Object.entries(packageJson.exports)) {
        const defaultCondition = conditions.default;
        if (!defaultCondition || !/fesm2022/.test(defaultCondition)) {
          continue;
        }
        packageJson.exports[subpath] = {
          "ng-linked": `${defaultCondition}.linked.mjs`,
          ...conditions,
        };
      }

      // Also update side effects to include the new linked bundles
      const sideEffects = packageJson.exports.sideEffects;
      if (sideEffects !== undefined && Array.isArray(sideEffects)) {
        for (const pattern in sideEffects) {
          if (!pattern.includes("*") && pattern.startsWith("./fesm2022/")) {
            sideEffects.push(`${pattern}.linked.mjs`);
          }
        }
      }

      await writeFile("package.json", JSON.stringify(packageJson, null, 2));
    })(),
  );

  await Promise.all(tasks);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
