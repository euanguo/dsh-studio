import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "website");
const output = path.join(root, ".stage", "pages");
const assets = path.join(output, "assets");

await rm(output, { force: true, recursive: true });
await mkdir(assets, { recursive: true });
await cp(source, output, { recursive: true });
await cp(
    path.join(root, "assets", "dsh-studio-landing.png"),
    path.join(assets, "dsh-studio-landing.png"),
);
await writeFile(path.join(output, ".nojekyll"), "");

console.log(`Built GitHub Pages site at ${output}`);
