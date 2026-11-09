// Yerel sunucunun güvenlik kapıları: anahtar, adres kontrolü, sadece taramanın önerdiği işlemler.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.js";

const fakeScan = async () => ({
  result: { services: [], at: "now" },
  registry: new Map([
    ["a1", { kind: "fix", id: "does-not-exist", projects: [{ id: "p1", name: "one" }], selectable: true }],
    ["a2", { kind: "drill", type: "nope", teamId: "t", projects: [] }],
  ]),
});

test("yerel sunucu: yetkisiz ve uydurma istekleri reddeder", async (t) => {
  const { server, url } = await startServer({ dir: process.cwd(), scanImpl: fakeScan });
  t.after(() => server.close());
  const page = await (await fetch(url)).text();
  const token = page.match(/name="va-token" content="([a-f0-9]{48})"/)[1];
  const call = (path, { body, headers = {}, type = "application/json" } = {}) =>
    fetch(new URL(path, url), { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": type }), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const auth = { "x-va-token": token };

  assert.equal((await call("/api/scan")).status, 401, "anahtarsız istek");
  assert.equal((await call("/api/scan", { headers: { "x-va-token": "0".repeat(48) } })).status, 401, "yanlış anahtar");
  assert.equal((await call("/api/scan", { headers: auth })).status, 200);
  assert.equal((await call("/api/act", { headers: auth, body: "key=a1", type: "text/plain" })).status, 415, "form gönderimi (CSRF) kabul edilmez");
  assert.equal((await call("/api/act", { headers: auth, body: { key: "zzz" } })).status, 400, "taramanın önermediği işlem");
  assert.equal((await call("/api/act", { headers: auth, body: { key: "a1", projectIds: ["p2"] } })).status, 400, "izin verilmeyen site");
  assert.equal((await call("/api/act", { headers: auth, body: { key: "a1", projectIds: [] } })).status, 400, "site seçilmeden işlem yapılmaz");
  assert.equal((await call("/api/act", { headers: auth, body: { key: "a2", projectIds: [] } })).status, 400, "tatbikat tam bir site ister");
  const ok = await call("/api/act", { headers: auth, body: { key: "a1", projectIds: ["p1"] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: false, log: ["unknown fix does-not-exist"] });
  assert.equal((await call("/api/answer", { headers: auth, body: { id: "../x", value: "yes" } })).status, 400);
  assert.equal((await call("/nope", { headers: auth })).status, 404);

  // Host başlığı farklıysa (DNS rebinding) reddedilir
  const http = await import("node:http");
  const status = await new Promise((resolve) => http.get(url, { headers: { host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode); }));
  assert.equal(status, 403);
});
