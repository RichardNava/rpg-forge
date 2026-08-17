import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderCharacterSheetSpike } from "../pdf-renderer/src/renderer";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const artifactsDirectory = resolve(scriptDirectory, "..", "artifacts");

await mkdir(artifactsDirectory, { recursive: true });

const [blankPdf, npcPdf] = await Promise.all([
  renderCharacterSheetSpike({ prefilled: false }),
  renderCharacterSheetSpike({ prefilled: true }),
]);

const blankPath = resolve(artifactsDirectory, "sample.pdf");
const npcPath = resolve(artifactsDirectory, "sample-npc.pdf");
await Promise.all([writeFile(blankPath, blankPdf), writeFile(npcPath, npcPdf)]);

console.log(`Generated ${blankPath}`);
console.log(`Generated ${npcPath}`);
