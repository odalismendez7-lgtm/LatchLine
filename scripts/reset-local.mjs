// Deletes the local development databases under .data/ (nothing else). Stop the servers first.
import { rmSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../.data/", import.meta.url));
if (!existsSync(dir)) { console.log("Nothing to reset (.data/ does not exist)."); process.exit(0); }
const files = readdirSync(dir).filter((f) => /\.sqlite(-wal|-shm)?$/.test(f));
for (const f of files) rmSync(dir + f);
console.log(files.length ? `Deleted: ${files.join(", ")}` : "No local databases found.");
