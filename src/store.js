// Yerel kayıt: elle verilen cevaplar, tatbikat sonuçları, bekçinin son çalışması.
// Hepsi sadece bu bilgisayarda, ~/.vibeamigo altında durur. Hiçbir anahtar ya da şifre burada saklanmaz.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DIR = process.env.VIBEAMIGO_HOME || path.join(homedir(), ".vibeamigo");

async function load(name) {
  try {
    return JSON.parse(await readFile(path.join(DIR, `${name}.json`), "utf8"));
  } catch {
    return {};
  }
}

async function save(name, data) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const loadAnswers = () => load("answers");
export async function saveAnswer(id, value) {
  const all = await load("answers");
  all[id] = { value, at: new Date().toISOString() };
  await save("answers", all);
}

/** Tatbikat sonuçları: { [teamId]: { [type]: { at, project, ok, ... } } } */
export const loadDrills = () => load("drills");
export async function saveDrill(teamId, type, result) {
  const all = await load("drills");
  (all[teamId] ??= {})[type] = { ...result, at: new Date().toISOString() };
  await save("drills", all);
}

export const loadWatch = () => load("watch");
export const saveWatch = (data) => save("watch", data);
