// Komut çalıştırma yardımcıları. Kabuk (shell) kullanılmaz: argümanlar dizi olarak geçer,
// böylece proje adı gibi değerler komut olarak yorumlanamaz.
import { execFile } from "node:child_process";

/** Bir programı çalıştırır, { ok, code, stdout, stderr } döner. Asla hata fırlatmaz. */
export function run(cmd, args, { timeout = 120_000, cwd, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout, cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } },
      (err, stdout, stderr) => {
        resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (input) child.stdin.end(input);
  });
}

/** Çıktının içindeki ilk JSON nesnesini ayıklar (CLI'lar başa uyarı satırı basabiliyor). */
export function parseJson(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}
