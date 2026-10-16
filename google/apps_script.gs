/**
 * Приём заявок из каталога в Google-таблицу (лист «Заявки»).
 * Установка: Таблица → Расширения → Apps Script → вставить этот код →
 * Развернуть → Новое развёртывание → Веб-приложение → Доступ: «Все» → скопировать URL в docs/config.js (ORDERS_ENDPOINT).
 */
const SHEET_NAME = "Заявки";
const HEADERS = ["Дата", "Тип", "Имя", "Телефон", "Город", "Состав", "Сумма", "Цена", "Согласие ПДн", "Рассылка"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    // Без согласия на обработку ПДн заявку не сохраняем
    if (!d.consent_pd) return json({ ok: false, error: "no consent" });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);

    const items = (d.items || []).map(function (i) { return i.name + " " + i.size + "×" + i.qty + " по " + i.price; }).join("\n");
    sh.appendRow([
      new Date(), d.type === "order" ? "Заказ" : "Звонок",
      clean(d.name), "'" + clean(d.phone), clean(d.city),
      items, Number(d.total) || 0, clean(d.tier),
      d.consent_pd ? "да" : "нет", d.consent_ads ? "да" : "нет"
    ]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Защита от формул в ячейках (=, +, -, @ в начале)
function clean(s) {
  s = String(s || "").slice(0, 300);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
