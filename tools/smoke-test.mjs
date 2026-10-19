// Смоук-тест в мобильном Chromium: карта рисуется, тапы по микрогосударствам работают,
// service worker регистрируется, приложение открывается офлайн.
// Запуск: из корня проекта поднять сервер (npx http-server -p 8080 -c-1), затем: cd tools && node smoke-test.mjs
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}
const URL = process.env.APP_URL || "http://localhost:8080/";
const shots = process.env.SHOTS || path.join(here, "shots");

let failed = 0;
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) failed++; };

const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({
  ...playwright.devices["iPhone 13"],
  browserName: undefined,
  defaultBrowserType: undefined,
  colorScheme: process.env.DARK ? "dark" : "light",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(URL);
await page.waitForFunction(() => window.__geogame && document.querySelectorAll("#map path.country").length > 50);

console.log("Карта");
const n = await page.$$eval("#map path[data-code]", (els) => els.length);
check(n >= 50, `нарисовано играбельных стран: ${n}`);
const off = await page.$$eval("#map path.off", (els) => els.map((e) => e.dataset.code).sort().join(","));
check(off === "AM,AZ,CY,GE,RU,TR", `опциональные страны выключены по умолчанию: ${off}`);
const markers = await page.$$eval("#map .marker:not(.hidden)", (els) => els.map((e) => e.dataset.code).sort().join(","));
check(markers === "AD,LI,LU,MC,MT,SM,VA", `маркеры микрогосударств: ${markers}`);
await page.screenshot({ path: path.join(shots, "1-map.png") });

async function tapCode(code, dx = 0, dy = 0) {
  const pt = await page.evaluate((c) => {
    const { M } = window.__geogame;
    const r = document.querySelector("#map").getBoundingClientRect();
    const [x, y] = M.screenPt(c);
    return { x: r.left + x, y: r.top + y };
  }, code);
  await page.touchscreen.tap(pt.x + dx, pt.y + dy);
  await page.waitForTimeout(120);
  return page.evaluate(() => window.__geogame.ui.studySel);
}

console.log("Тапы (режим «Изучение»)");
for (const code of ["AD", "MC", "LI", "SM", "VA", "MT", "LU"]) {
  const got = await tapCode(code);
  check(got === code, `тап по маркеру ${code} -> ${got}`);
  await page.evaluate(() => { window.__geogame.ui.studySel = null; });
}
// Невидимый круг: тап мимо маркера в море рядом с Мальтой.
check((await tapCode("MT", 16, 6)) === "MT", "тап в 17px от Мальты (море) попадает в Мальту");
await page.evaluate(() => { window.__geogame.ui.studySel = null; });
check((await tapCode("FR")) === "FR", "тап по Франции");
check((await tapCode("DE")) === "DE", "тап по Германии");
const card = await page.textContent("#panel");
check(card.includes("Германия") && card.includes("Берлин"), "карточка показывает «Германия — Берлин»");
await page.screenshot({ path: path.join(shots, "2-study-card.png") });

console.log("Тест «как на экзамене»");
await page.click('#tabbar [data-tab="test"]');
await page.click('[data-action="examInput"][data-v="voice"]');
await page.click('[data-action="start"][data-mode="exam"]');
const target = await page.evaluate(() => window.__geogame.ui.session.cur);
// Специально ошибаемся: тапаем другую страну.
const wrong = target === "PL" ? "ES" : "PL";
await tapCode(wrong);
let s = await page.evaluate(() => ({ step: window.__geogame.ui.session.step, locOk: window.__geogame.ui.session.locOk }));
check(s.step === "located" && s.locOk === false, "ошибочный тап: шаг «located», locOk=false");
check(await page.$eval(`#map path[data-code="${wrong}"]`, (e) => e.classList.contains("bad")), "тапнутая страна красная");
const okEl = (await page.evaluate((c) => window.__geogame.BY[c].micro, target)) ? `#map .marker[data-code="${target}"]` : `#map path[data-code="${target}"]`;
check(await page.$eval(okEl, (e) => e.classList.contains("ok")), "правильная страна зелёная");
check(await page.$$eval(".fx .pulse", (e) => e.length) > 0, "пульсация на правильной стране");
await page.screenshot({ path: path.join(shots, "3-test-wrong.png") });
await page.click('[data-action="hint"]');
check((await page.textContent("#panel")).includes("Столица на"), "подсказка первой буквы");
await page.click('[data-action="reveal"]');
await page.screenshot({ path: path.join(shots, "4-test-reveal.png") });
await page.click('[data-action="selfGrade"][data-ok="1"]');
s = await page.evaluate(() => ({ i: window.__geogame.ui.session.i, p: window.__geogame.store().progress }));
check(s.i === 1, "счётчик вопросов увеличился");
check(s.p[target] && s.p[target].wrong === 1 && s.p[target].box === 1, "ошибка вернула страну в коробку 1");

// Два правильных ответа подряд -> «выучено».
for (let k = 0; k < 2; k++) {
  const cur = await page.evaluate(() => window.__geogame.ui.session.cur);
  await tapCode(cur);
  await page.click('[data-action="reveal"]');
  await page.click('[data-action="selfGrade"][data-ok="1"]');
  const st = await page.evaluate((c) => window.__geogame.store().progress[c], cur);
  if (k === 1) check(st.streak >= 1, `верный ответ (${cur}) увеличил серию`);
}
await page.click('[data-action="quit"]');

console.log("Экзамен с вводом столицы");
await page.click('[data-action="examInput"][data-v="keyboard"]');
await page.click('[data-action="start"][data-mode="exam"]');
{
  let cur = await page.evaluate(() => window.__geogame.ui.session.cur);
  await tapCode(cur);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "capInput"), "после тапа по карте поле ввода в фокусе");
  const cap = await page.evaluate((c) => window.__geogame.BY[c].capital, cur);
  await page.fill("#capInput", cap.toLowerCase());
  await page.press("#capInput", "Enter");
  let st = await page.evaluate(() => { const s = window.__geogame.ui.session; return { v: s.verdict, ok: s.okCount, step: s.step }; });
  check(st.v === "exact" && st.ok === 1 && st.step === "checked", "верное место + верная столица = верный ответ");
  await page.screenshot({ path: path.join(shots, "13-exam-typed.png") });
  await page.press("#capInput", "Enter");
  await page.waitForFunction(() => window.__geogame.ui.session.step === "ask");
  cur = await page.evaluate(() => window.__geogame.ui.session.cur);
  const wrong = cur === "PL" ? "ES" : "PL";
  await tapCode(wrong);
  const cap2 = await page.evaluate((c) => window.__geogame.BY[c].capital, cur);
  await page.fill("#capInput", cap2);
  await page.click('#capForm button[type="submit"]');
  st = await page.evaluate((c) => ({ ok: window.__geogame.ui.session.okCount, p: window.__geogame.store().progress[c] }), cur);
  check(st.ok === 1 && st.p.locWrong >= 1 && st.p.box === 1, "неверное место при верной столице = ошибка, страна в коробке 1");
  await page.screenshot({ path: path.join(shots, "14-exam-typed-wrongloc.png") });
  await page.click('#capForm button[type="submit"]');
  cur = await page.evaluate(() => window.__geogame.ui.session.cur);
  await tapCode(cur);
  await page.click('[data-action="giveUp"]');
  check(await page.evaluate(() => window.__geogame.ui.session.verdict) === "wrong", "«Не знаю» в экзамене = ошибка");
}
await page.click('[data-action="quit"]');

console.log("Остальные режимы");
for (const mode of ["reverse", "capitals", "blitz"]) {
  await page.click(`[data-action="start"][data-mode="${mode}"]`);
  if (mode === "reverse") {
    await page.screenshot({ path: path.join(shots, "5-reverse.png") });
    await page.click('[data-action="reveal"]');
    await page.click('[data-action="selfGrade"][data-ok="0"]');
  } else if (mode === "capitals") {
    const opts = await page.$$eval('[data-action="choose"]', (e) => e.length);
    check(opts === 4, "4 варианта столицы");
    await page.screenshot({ path: path.join(shots, "6-capitals.png") });
    await page.click('[data-action="choose"]');
    await page.waitForTimeout(1900);
  } else {
    for (let k = 0; k < 20; k++) {
      await page.waitForFunction(() => window.__geogame.ui.session.step === "ask");
      const cur = await page.evaluate(() => window.__geogame.ui.session.cur);
      await tapCode(cur);
      const cap = await page.evaluate((c) => window.__geogame.BY[c].capital, cur);
      if (k === 3) await page.screenshot({ path: path.join(shots, "7-blitz.png") });
      await page.click(`[data-action="choose"][data-cap="${cap}"]`);
    }
    await page.waitForFunction(() => window.__geogame.ui.session.done);
    const res = await page.textContent("#page");
    check(res.includes("20 из 20"), "блиц завершён: 20 из 20" + (res.includes("20 из 20") ? "" : " — " + res.replace(/\s+/g, " ").slice(0, 200)));
    await page.screenshot({ path: path.join(shots, "8-blitz-result.png") });
  }
  await page.click('[data-action="quit"]');
}

console.log("Длина сессии «Все»");
await page.click('[data-action="sessionLen"][data-n="all"]');
await page.click('[data-action="start"][data-mode="capitals"]');
const all = await page.evaluate(() => { const s = window.__geogame.ui.session; return { len: s.len, uniq: new Set(s.order).size }; });
check(all.len === 44 && all.uniq === 44, `«Все»: ${all.len} вопросов, без повторов (${all.uniq} разных)`);
await page.click('[data-action="quit"]');
await page.click('[data-action="sessionLen"][data-n="10"]');
await page.click('[data-action="start"][data-mode="blitz"]');
check(await page.evaluate(() => window.__geogame.ui.session.len) === 10, "блиц учитывает выбранную длину (10)");
await page.click('[data-action="quit"]');
await page.click('[data-action="sessionLen"][data-n="20"]');

console.log("Столица с клавиатуры");
await page.click('[data-action="start"][data-mode="typing"]');
check(await page.evaluate(() => document.activeElement && document.activeElement.id === "capInput"), "поле ввода в фокусе");
let cur = await page.evaluate(() => window.__geogame.ui.session.cur);
let cap = await page.evaluate((c) => window.__geogame.BY[c].capital, cur);
await page.fill("#capInput", cap.toUpperCase().replace(/ё/g, "Е"));
await page.press("#capInput", "Enter");
check(await page.evaluate(() => window.__geogame.ui.session.verdict) === "exact", `точный ответ «${cap}» без учёта регистра и ё`);
await page.screenshot({ path: path.join(shots, "11-typing-ok.png") });
await page.press("#capInput", "Enter");
await page.waitForFunction(() => window.__geogame.ui.session.step === "ask");
cur = await page.evaluate(() => window.__geogame.ui.session.cur);
cap = await page.evaluate((c) => window.__geogame.BY[c].capital, cur);
const typo = cap.length >= 5 ? cap.slice(0, -2) + cap.slice(-1) : cap;
await page.fill("#capInput", typo);
await page.click('#capForm button[type="submit"]');
const v = await page.evaluate(() => window.__geogame.ui.session.verdict);
check(v === (cap.length >= 5 ? "close" : "exact"), `опечатка «${typo}» для «${cap}» засчитана (${v})`);
await page.click('#capForm button[type="submit"]');
await page.waitForFunction(() => window.__geogame.ui.session.step === "ask");
await page.fill("#capInput", "Нью-Йорк");
await page.press("#capInput", "Enter");
check(await page.evaluate(() => window.__geogame.ui.session.verdict) === "wrong", "неверный ответ отклонён");
await page.screenshot({ path: path.join(shots, "12-typing-wrong.png") });
await page.press("#capInput", "Enter");
await page.click('[data-action="giveUp"]');
check(await page.evaluate(() => window.__geogame.ui.session.verdict) === "wrong", "«Не знаю» засчитано как ошибка");
check(await page.evaluate(() => window.__geogame.ui.session.okCount) === 2, "счётчик: 2 верных из 4");
await page.click('[data-action="quit"]');

console.log("Ошибки и статистика");
await page.click('#tabbar [data-tab="errors"]');
check(await page.$('[data-action="trainWeak"]') !== null, "есть кнопка «Тренировать только их»");
await page.screenshot({ path: path.join(shots, "9-errors.png") });
await page.click('#tabbar [data-tab="stats"]');
check((await page.textContent("#page")).includes("По регионам"), "экран статистики");
await page.screenshot({ path: path.join(shots, "10-stats.png") });

console.log("Настройки");
await page.click('[data-action="settings"]');
await page.click('[data-key="group:russia"]');
await page.click('[data-action="closeSheet"]');
check(!(await page.$eval('#map path[data-code="RU"]', (e) => e.classList.contains("off"))), "переключатель «Россия» включает страну");
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("geogame.v1")).settings.byCont.europe.groups.russia);
check(persisted === true, "настройка сохранена в localStorage");

console.log("Азия");
await page.click('#tabbar [data-tab="map"]');
await page.click('[data-action="pickContinent"]');
await page.click('[data-action="setContinent"][data-cont="asia"]');
await page.waitForFunction(() => window.__geogame.CONT === "asia" && document.querySelector('#map path[data-code="CN"]'));
const asia = await page.evaluate(() => ({
  n: document.querySelectorAll("#map path[data-code]:not(.off)").length,
  off: [...document.querySelectorAll("#map path.off")].map((e) => e.dataset.code).sort().join(","),
}));
check(asia.n === 46, `Азия: активных стран на карте ${asia.n}`);
check(asia.off === "CY,PS,RU,TW", `опциональные страны Азии выключены: ${asia.off}`);
await page.screenshot({ path: path.join(shots, "15-asia.png") });
for (const code of ["SG", "BH", "MV", "CN", "IN", "JP", "KZ"]) {
  await page.evaluate(() => { window.__geogame.ui.studySel = null; });
  const got = await tapCode(code);
  check(got === code, `Азия: тап ${code} -> ${got}`);
}
check((await page.textContent("#panel")).includes("Астана"), "карточка: Казахстан — Астана");
await page.click('#tabbar [data-tab="test"]');
await page.click('[data-action="start"][data-mode="exam"]');
{
  const cur = await page.evaluate(() => window.__geogame.ui.session.cur);
  await tapCode(cur);
  const c = await page.evaluate((k) => window.__geogame.BY[k], cur);
  await page.fill("#capInput", c.capital);
  await page.press("#capInput", "Enter");
  check(await page.evaluate(() => window.__geogame.ui.session.okCount) === 1, `Азия, экзамен: ${c.name} — ${c.capital} засчитано`);
  await page.screenshot({ path: path.join(shots, "16-asia-exam.png") });
}
await page.click('[data-action="quit"]');
const lk = await page.evaluate(() => window.__geogame.BY.LK.capital);
check(lk.startsWith("Шри"), "у Шри-Ланки есть столица");
await page.click('[data-action="pickContinent"]');
await page.click('[data-action="setContinent"][data-cont="europe"]');
await page.waitForFunction(() => window.__geogame.CONT === "europe" && document.querySelector('#map path[data-code="FR"]'));
check(await page.evaluate(() => JSON.parse(localStorage.getItem("geogame.v1")).settings.continent) === "europe", "выбор части света сохраняется");

console.log("Service worker и офлайн");
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active && reg.active.state;
});
check(swState === "activated", `service worker: ${swState}`);
await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__geogame && document.querySelectorAll("#map path.country").length > 50, null, { timeout: 8000 })
  .then(() => check(true, "после перезагрузки офлайн карта рисуется"))
  .catch(() => check(false, "после перезагрузки офлайн карта рисуется"));
await ctx.setOffline(false);

check(errors.length === 0, "нет ошибок в консоли" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки пройдены");
process.exit(failed ? 1 : 0);
