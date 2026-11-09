#!/usr/bin/env node
// VibeAmigo: yerel paneli başlatır ve tarayıcıda açar.
//   npx vibeamigo            → bu klasördeki projeyi ve hesaplarını kontrol eder
//   npx vibeamigo --dir ../x → başka bir klasör
//   npx vibeamigo --no-open  → tarayıcıyı açma, sadece adresi yaz
import { spawn } from "node:child_process";
import path from "node:path";
import { startServer } from "../src/server.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.includes("--help") || args.includes("-h")) {
  console.log(`VibeAmigo — spend & security check

  npx vibeamigo              check this folder's project and your accounts
  npx vibeamigo --dir PATH   check another folder
  npx vibeamigo --no-open    don't open the browser
  npx vibeamigo --port N     use a fixed port

Everything runs on your computer. Nothing is sent anywhere.`);
  process.exit(0);
}

const dir = path.resolve(opt("--dir") ?? process.cwd());
const { url } = await startServer({ dir, port: Number(opt("--port") ?? 0) });

console.log(`\n  VibeAmigo çalışıyor / is running → ${url}\n  Proje / Project: ${dir}\n  Kapatmak için / To stop: Ctrl+C\n`);

if (!args.includes("--no-open")) {
  const [cmd, cmdArgs] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
