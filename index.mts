import linkerBabelPlugin from "@angular/compiler-cli/linker/babel";
import * as babel from "@babel/core";
import assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

interface PackageJson {
  exports?: Record<string, Record<string, string>>;
  sideEffects?: boolean | string[];
}

async function main() {
  const fesmBundles = globSync("fesm2022/**/*.mjs");
  const tasks = [];
  const babelOptions: babel.PluginOptions = {
    plugins: [[linkerBabelPlugin, {}], [importPlugin()]],
    configFile: false,
    babelrc: false,
  };

  for (const bundleFile of fesmBundles) {
    tasks.push(
      (async () => {
        const content = await readFile(bundleFile, "utf8");
        const result = await babel.transformAsync(content, {
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
      const packageJson = JSON.parse(packageJsonRaw) as PackageJson;

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
      const sideEffects = packageJson.sideEffects;
      if (sideEffects !== undefined && Array.isArray(sideEffects)) {
        const newSideEffects = [...sideEffects];

        for (const pattern of sideEffects) {
          if (!pattern.includes("*") && pattern.startsWith("./fesm2022/")) {
            newSideEffects.push(`${pattern}.linked.mjs`);
          }
        }

        packageJson.sideEffects = newSideEffects;
      }

      await writeFile("package.json", JSON.stringify(packageJson, null, 2));
    })(),
  );

  await Promise.all(tasks);
}

const importPlugin: () => babel.PluginObj = () => {
  return {
    visitor: {
      ImportDeclaration(path) {
        if (!path.node.source.value.startsWith(".")) {
          return;
        }
        // Relative imports should also point to their linked variants.
        path.node.source.value = `${path.node.source.value}.linked.mjs`;
      },
      ExportNamedDeclaration(path) {
        if (!path.node.source || !path.node.source.value.startsWith(".")) {
          return;
        }
        // Relative exports should also point to their linked variants.
        path.node.source.value = `${path.node.source.value}.linked.mjs`;
      },
      ExportAllDeclaration(path) {
        if (!path.node.source.value.startsWith(".")) {
          return;
        }
        // Relative exports should also point to their linked variants.
        path.node.source.value = `${path.node.source.value}.linked.mjs`;
      },
    },
  };
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
