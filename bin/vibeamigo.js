#!/usr/bin/env node
// VibeAmigo
//   vibeamigo                 yerel paneli açar (tarayıcıda)
//   vibeamigo scan [--json]   paneli açmadan tarar, sonucu yazar (yapay zekâ ajanları ve betikler için)
//   vibeamigo watch [...]     bekçi: kontrol eder, haber verir, istenirse freni çeker
import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("-") ? args.shift() : "panel";
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const lang = opt("--lang") ?? ((process.env.LANG || "").toLowerCase().startsWith("tr") ? "tr" : "en");
const dir = path.resolve(opt("--dir") ?? process.cwd());

const HELP = `VibeAmigo — spend & security check for vibe-coded apps

  vibeamigo                      open the local panel for this folder's project and your accounts
  vibeamigo scan [--json]        scan without the panel and print the result (for AI agents and scripts)
  vibeamigo watch                watchdog: check once, report, exit 0 (clear) / 1 (alarm) / 2 (could not check)
      --loop <minutes>           keep checking while this computer is on
      --brake attack             on a traffic spike, turn on attack mode for that site for 1 hour
      --heal                     add the rate limit rule to sites that don't have it
      --strict                   treat warnings as alarms
      --min <n> --factor <x>     spike = at least <n> requests in 10 min AND <x> times the site's normal (2000, 10)

  Common options:  --dir <path>   --lang tr|en   --port <n>   --no-open

Everything runs on your computer. Nothing is sent anywhere.`;

if (flag("--help") || flag("-h") || cmd === "help") {
  console.log(HELP);
  process.exit(0);
}

if (cmd === "watch") {
  const { watchCommand } = await import("../src/watch.js");
  const num = (v) => (v === undefined ? undefined : Number(v));
  const code = await watchCommand({ lang, loop: num(opt("--loop")), brake: opt("--brake") ?? "none", heal: flag("--heal"), strict: flag("--strict"), json: flag("--json"), minAbs: num(opt("--min")), factor: num(opt("--factor")) });
  process.exit(code);
} else if (cmd === "scan") {
  const { fullScan } = await import("../src/server.js");
  const { result } = await fullScan(dir);
  if (flag("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    const LABEL = { tested: ["DENENDİ", "TESTED"], on: ["AÇIK", "ON"], clean: ["TEMİZ", "CLEAN"], self: ["SEN ONAYLADIN", "YOU CONFIRMED"], ready: ["HAZIR", "READY"], bad: ["RİSK", "AT RISK"], warn: ["EKSİK", "PARTIAL"], unk: ["BAKMAN LAZIM", "PLEASE CHECK"] };
    const tx = (v) => (typeof v === "string" ? v : (v?.[lang] ?? v?.tr ?? ""));
    for (const s of result.services) {
      console.log(`\n${tx(s.name)}`);
      for (const c of s.checks) console.log(`  [${(LABEL[c.status] ?? ["?", "?"])[lang === "tr" ? 0 : 1]}] ${tx(c.title)} — ${tx(c.detail)}`);
    }
  }
  process.exit(result.services.some((s) => s.checks.some((c) => c.status === "bad")) ? 1 : 0);
} else if (cmd === "panel") {
  const { startServer } = await import("../src/server.js");
  const { url } = await startServer({ dir, port: Number(opt("--port") ?? 0) });
  console.log(`\n  VibeAmigo çalışıyor / is running → ${url}\n  Proje / Project: ${dir}\n  Kapatmak için / To stop: Ctrl+C\n`);
  if (!flag("--no-open")) {
    const [c, a] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    spawn(c, a, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  }
} else {
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exit(64);
}
