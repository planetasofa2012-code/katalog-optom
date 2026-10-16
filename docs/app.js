// Каталог в кармане — каталог, корзина с лестницей цен, заявка в WhatsApp
(() => {
  const CFG = window.APP_CONFIG;
  const $ = (s) => document.querySelector(s);
  const rub = (n) => Math.round(n).toLocaleString("ru-RU") + " ₽";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Безопасная работа с localStorage (может быть недоступен в приватном режиме)
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  let products = [];
  let cart = store.get("cart", {}); // { "F-001|M": 10 }
  const state = { cat: "", size: "", stockOnly: true };

  // ---------- Загрузка каталога ----------
  function parseSizes(str) {
    // "S:12;M:30" → [{size:"S", stock:12}, ...]
    return String(str || "").split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [size, stock] = p.split(":");
      return { size: size.trim(), stock: Math.max(0, parseInt(stock, 10) || 0) };
    });
  }

  function parseCSV(text) {
    // Простой парсер CSV с поддержкой кавычек
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
  }

  function normalize(p) {
    return {
      ...p,
      price_retail: +p.price_retail, price_qty: +p.price_qty || +p.price_retail,
      qty_threshold: +p.qty_threshold || 0, price_wholesale: +p.price_wholesale || +p.price_qty || +p.price_retail,
      sizes: parseSizes(p.sizes)
    };
  }

  async function loadCatalog() {
    try {
      let raw;
      if (CFG.SHEET_CSV_URL) {
        const r = await fetch(CFG.SHEET_CSV_URL, { cache: "no-store" });
        raw = parseCSV(await r.text()).filter((p) => p.hidden !== "1");
      } else {
        const r = await fetch("data/products.json", { cache: "no-cache" });
        raw = await r.json();
      }
      products = raw.map(normalize);
      store.set("catalog", products);
    } catch {
      // Офлайн — последний сохранённый каталог
      products = store.get("catalog", []);
      if (products.length) toast("Нет интернета — показан сохранённый каталог");
    }
  }

  // ---------- Картинка-заглушка (SVG силуэт одежды) ----------
  function shapeSVG(type, color) {
    const stroke = "rgba(0,0,0,.35)";
    const paths = {
      tee: "M30 10 L45 4 Q50 12 55 4 L70 10 L88 26 L76 38 L68 31 L68 92 L32 92 L32 31 L24 38 L12 26 Z",
      polo: "M30 10 L44 4 L50 16 L56 4 L70 10 L88 26 L76 38 L68 31 L68 92 L32 92 L32 31 L24 38 L12 26 Z M44 4 L50 24 L56 4",
      longsleeve: "M30 10 L45 4 Q50 12 55 4 L70 10 L94 70 L82 74 L68 38 L68 92 L32 92 L32 38 L18 74 L6 70 Z",
      hoodie: "M32 12 Q50 -6 68 12 L94 70 L82 74 L68 40 L68 92 L32 92 L32 40 L18 74 L6 70 Z M40 14 Q50 30 60 14",
      pants: "M30 6 L70 6 L74 94 L56 94 L50 34 L44 94 L26 94 Z"
    };
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${paths[type] || paths.tee}" fill="${esc(color || "#ddd")}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }
  const imgHTML = (p) => p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : shapeSVG(p.type, p.color);

  // ---------- Цены ----------
  // Ступени: 1) штучная; 2) от N шт одной модели; 3) от суммы заказа — оптовая на всё
  function priceCart() {
    const lines = Object.entries(cart).map(([key, qty]) => {
      const [id, size] = key.split("|");
      return { key, id, size, qty, p: products.find((x) => x.id === id) };
    }).filter((l) => l.p && l.qty > 0);

    const qtyByModel = {};
    lines.forEach((l) => (qtyByModel[l.id] = (qtyByModel[l.id] || 0) + l.qty));

    // Сумма по ступени «от N шт» — по ней считаем порог оптовой цены
    let base = 0, retailSum = 0;
    lines.forEach((l) => {
      l.unit = qtyByModel[l.id] >= l.p.qty_threshold ? l.p.price_qty : l.p.price_retail;
      l.tier = l.unit === l.p.price_qty && l.p.price_qty !== l.p.price_retail ? "qty" : "retail";
      base += l.unit * l.qty;
      retailSum += l.p.price_retail * l.qty;
    });

    const wholesale = base >= CFG.WHOLESALE_SUM;
    let total = 0;
    lines.forEach((l) => {
      if (wholesale) { l.unit = l.p.price_wholesale; l.tier = "wholesale"; }
      total += l.unit * l.qty;
    });
    const count = lines.reduce((s, l) => s + l.qty, 0);
    return { lines, total, retailSum, base, wholesale, count, left: Math.max(0, CFG.WHOLESALE_SUM - base), qtyByModel };
  }

  // ---------- Рендер каталога ----------
  function renderFilters() {
    const cats = [...new Set(products.map((p) => p.category))];
    $("#categories").innerHTML = ["", ...cats].map((c) =>
      `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c || "Все")}</button>`).join("");
    const sizes = [...new Set(products.flatMap((p) => p.sizes.map((s) => s.size)))];
    $("#sizeFilter").innerHTML = `<option value="">любой</option>` + sizes.map((s) => `<option ${state.size === s ? "selected" : ""}>${esc(s)}</option>`).join("");
  }

  function renderGrid() {
    const list = products.filter((p) =>
      (!state.cat || p.category === state.cat) &&
      (!state.size || p.sizes.some((s) => s.size === state.size && (!state.stockOnly || s.stock > 0))) &&
      (!state.stockOnly || p.sizes.some((s) => s.stock > 0)));
    $("#grid").innerHTML = list.length ? list.map((p) => `
      <article class="card">
        <div class="card__img" data-open="${esc(p.id)}">${imgHTML(p)}</div>
        <div class="card__body">
          <h3 class="card__name">${esc(p.name)}</h3>
          <p class="card__meta">${esc(p.composition)} · ${esc(p.colors)}</p>
          ${ladderHTML(p)}
          <div class="sizes-line">Размеры: ${p.sizes.map((s) => `<span class="${s.stock ? "" : "out"}">${esc(s.size)}</span>`).join(" · ")}</div>
          <button class="btn btn--block" data-open="${esc(p.id)}">Выбрать размеры</button>
        </div>
      </article>`).join("") : `<div class="empty">Ничего не нашлось. Сбросьте фильтры.</div>`;
  }

  function ladderHTML(p) {
    return `<ul class="ladder">
      <li><span>1 шт</span><b>${rub(p.price_retail)}</b></li>
      <li><span>от ${p.qty_threshold} шт модели</span><b>${rub(p.price_qty)}</b></li>
      <li class="best"><span>заказ от ${rub(CFG.WHOLESALE_SUM)}</span><b>${rub(p.price_wholesale)}</b></li>
    </ul>`;
  }

  // ---------- Карточка товара ----------
  function openProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const rows = p.sizes.map((s) => {
      const q = cart[`${p.id}|${s.size}`] || 0;
      return `<div class="sizerow ${s.stock ? "" : "is-out"}">
        <div><div class="sizerow__name">${esc(s.size)}</div><div class="sizerow__stock">${s.stock ? `есть ${s.stock}` : "нет"}</div></div>
        <div></div>
        <div class="stepper">
          <button data-step="-1" data-size="${esc(s.size)}" ${s.stock ? "" : "disabled"} aria-label="меньше">−</button>
          <input inputmode="numeric" data-qty="${esc(s.size)}" value="${q}" ${s.stock ? "" : "disabled"} aria-label="Количество ${esc(s.size)}">
          <button data-step="1" data-size="${esc(s.size)}" ${s.stock ? "" : "disabled"} aria-label="больше">+</button>
        </div>
      </div>`;
    }).join("");
    showSheet(`
      <h2>${esc(p.name)}</h2>
      <div class="card__img">${imgHTML(p)}</div>
      <p class="card__meta">${esc(p.composition)}<br>Цвета: ${esc(p.colors)}</p>
      ${ladderHTML(p)}
      <h3 style="margin:16px 0 4px">Сколько каких размеров?</h3>
      <div class="quick">
        <button class="btn btn--ghost" data-fill="1">+1 каждого размера</button>
        <button class="btn btn--ghost" data-fill="0">Очистить</button>
      </div>
      <div class="sizegrid">${rows}</div>
      <p id="modelHint" class="muted"></p>
      <button class="btn btn--block" data-close>Готово</button>`, (body) => {
      const setQty = (size, val) => {
        const st = p.sizes.find((s) => s.size === size);
        const v = Math.max(0, Math.min(st.stock, val | 0));
        const key = `${p.id}|${size}`;
        if (v) cart[key] = v; else delete cart[key];
        body.querySelector(`[data-qty="${CSS.escape(size)}"]`).value = v;
        if (val > st.stock) toast(`Размер ${size}: в наличии только ${st.stock}`);
        saveCart(); hint();
      };
      const hint = () => {
        const n = p.sizes.reduce((s, x) => s + (cart[`${p.id}|${x.size}`] || 0), 0);
        body.querySelector("#modelHint").textContent = n === 0 ? "" :
          n >= p.qty_threshold ? `${n} шт — цена ${rub(p.price_qty)} за шт (или ниже при заказе от ${rub(CFG.WHOLESALE_SUM)})`
            : `${n} шт. Ещё ${p.qty_threshold - n} шт этой модели — и цена ${rub(p.price_qty)} вместо ${rub(p.price_retail)}`;
      };
      body.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.step) setQty(b.dataset.size, (cart[`${p.id}|${b.dataset.size}`] || 0) + +b.dataset.step);
        if (b.dataset.fill === "1") p.sizes.filter((s) => s.stock).forEach((s) => setQty(s.size, (cart[`${p.id}|${s.size}`] || 0) + 1));
        if (b.dataset.fill === "0") p.sizes.forEach((s) => s.stock && setQty(s.size, 0));
      });
      body.addEventListener("change", (e) => { if (e.target.dataset.qty) setQty(e.target.dataset.qty, parseInt(e.target.value, 10) || 0); });
      hint();
    });
  }

  // ---------- Корзина ----------
  function saveCart() { store.set("cart", cart); renderCartbar(); }

  function renderCartbar() {
    const c = priceCart();
    $("#cartbar").hidden = c.count === 0;
    $("#cartCount").textContent = c.count;
    $("#cartSum").textContent = rub(c.total);
  }

  function tierText(c) {
    if (c.wholesale) return `<b>✅ Оптовая цена на весь заказ!</b>`;
    const pct = Math.min(100, (c.base / CFG.WHOLESALE_SUM) * 100);
    return `<b>Ещё ${rub(c.left)} — и вся корзина пойдёт по оптовой цене</b>
      <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
  }

  function openCart() {
    const c = priceCart();
    if (!c.count) return toast("Корзина пустая");
    const lines = c.lines.map((l) => `<div class="cartline">
        <div>${esc(l.p.name)} — <b>${esc(l.size)}</b> × ${l.qty}<br><small>${rub(l.unit)} за шт · ${{ retail: "штучная", qty: "от " + l.p.qty_threshold + " шт", wholesale: "оптовая" }[l.tier]}</small></div>
        <div><b>${rub(l.unit * l.qty)}</b></div>
      </div>`).join("");
    const saved = c.retailSum - c.total;
    showSheet(`
      <h2>Корзина</h2>
      ${lines}
      <div class="tier">${tierText(c)}</div>
      <div class="totals">
        <span>Итого:</span><span class="big">${rub(c.total)}</span>
        ${saved > 0 ? `<span class="save">Экономия ${rub(saved)} по сравнению со штучной ценой</span>` : ""}
      </div>
      <button class="btn btn--block" id="toCheckout">Оформить заказ</button>
      <p></p>
      <button class="btn btn--ghost btn--block" id="clearCart">Очистить корзину</button>`, (body) => {
      body.querySelector("#toCheckout").onclick = () => openForm("order");
      body.querySelector("#clearCart").onclick = () => { cart = {}; saveCart(); closeSheet(); };
    });
  }

  // ---------- Форма заказа / обратного звонка ----------
  function openForm(type) {
    const saved = store.get("me", {});
    const isOrder = type === "order";
    showSheet(`
      <h2>${isOrder ? "Оформление заказа" : "Позвоните мне"}</h2>
      <p class="muted">${isOrder ? "Заказ уйдёт продавцу в WhatsApp. Он перезвонит и уточнит доставку и оплату." : "Оставьте номер — перезвоним и всё расскажем."}</p>
      <form class="form" id="leadForm" novalidate>
        <label class="field">Как вас зовут
          <input type="text" name="name" required autocomplete="name" value="${esc(saved.name)}"></label>
        <label class="field">Телефон
          <input type="tel" name="phone" required autocomplete="tel" placeholder="+7 ___ ___-__-__" value="${esc(saved.phone)}"></label>
        ${isOrder ? `<label class="field">Город
          <input type="text" name="city" autocomplete="address-level2" value="${esc(saved.city)}"></label>` : ""}
        <label class="check"><input type="checkbox" name="consent_pd" required>
          <span>Согласен(на) на обработку персональных данных по <a href="privacy.html" target="_blank">политике</a> *</span></label>
        <label class="check"><input type="checkbox" name="consent_ads">
          <span>Хочу получать новинки и скидки в мессенджер (можно отказаться в любой момент)</span></label>
        <button class="btn btn--wa btn--block" type="submit" disabled>${isOrder ? "Отправить заказ в WhatsApp" : "Жду звонка"}</button>
      </form>`, (body) => {
      const f = body.querySelector("#leadForm");
      const btn = f.querySelector("[type=submit]");
      const check = () => { btn.disabled = !(f.name.value.trim() && f.phone.value.replace(/\D/g, "").length >= 10 && f.consent_pd.checked); };
      f.addEventListener("input", check); f.addEventListener("change", check); check();
      f.addEventListener("submit", (e) => { e.preventDefault(); if (!btn.disabled) submitLead(type, f); });
    });
  }

  function orderText(c, lead) {
    const items = c.lines.map((l) => `• ${l.p.name} (${l.p.id}) — ${l.size} × ${l.qty} = ${rub(l.unit * l.qty)}`).join("\n");
    return `Здравствуйте! Заказ из каталога:\n${items}\n\nИтого: ${rub(c.total)}${c.wholesale ? " (оптовая цена)" : ""}\n\n${lead.name}, ${lead.phone}${lead.city ? ", " + lead.city : ""}`;
  }

  function submitLead(type, f) {
    const c = priceCart();
    const lead = {
      type, name: f.name.value.trim(), phone: f.phone.value.trim(), city: f.city ? f.city.value.trim() : "",
      items: type === "order" ? c.lines.map((l) => ({ id: l.id, name: l.p.name, size: l.size, qty: l.qty, price: l.unit })) : [],
      total: type === "order" ? c.total : 0,
      tier: type === "order" ? (c.wholesale ? "wholesale" : c.lines.some((l) => l.tier === "qty") ? "qty" : "retail") : "",
      consent_pd: f.consent_pd.checked, consent_ads: f.consent_ads.checked, ts: new Date().toISOString()
    };
    store.set("me", { name: lead.name, phone: lead.phone, city: lead.city });
    // Демо-база заявок в браузере
    const leads = store.get("leads", []); leads.unshift(lead); store.set("leads", leads);
    // Боевая база — Google-таблица через Apps Script (если подключена)
    if (CFG.ORDERS_ENDPOINT) {
      fetch(CFG.ORDERS_ENDPOINT, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(lead) }).catch(() => {});
    }
    const text = type === "order" ? orderText(c, lead) : `Здравствуйте! Перезвоните мне, пожалуйста: ${lead.name}, ${lead.phone}`;
    const wa = `https://wa.me/${CFG.WHATSAPP}?text=${encodeURIComponent(text)}`;
    if (type === "order") { cart = {}; saveCart(); }
    showSheet(`
      <h2>Спасибо, ${esc(lead.name)}!</h2>
      <p>${type === "order" ? "Заказ собран. Нажмите кнопку — откроется WhatsApp с готовым текстом, останется нажать «Отправить»." : "Мы получили ваш номер и скоро перезвоним."}</p>
      <a class="btn btn--wa btn--block" href="${wa}" target="_blank" rel="noopener">Открыть WhatsApp</a>
      <p></p>
      <button class="btn btn--ghost btn--block" data-close>Вернуться в каталог</button>`);
    if (type === "order") window.open(wa, "_blank", "noopener");
  }

  // ---------- Где нас найти ----------
  function openPlaces() {
    showSheet(`<h2>Где нас найти</h2>` + CFG.PLACES.map((p) => `
      <div class="place"><b>${esc(p.title)}</b><br><span class="muted">${esc(p.hours)}</span><br>
      ${esc(p.seller)}: <a href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${esc(p.phone)}</a></div>`).join("") +
      `<p></p><a class="btn btn--wa btn--block" href="https://wa.me/${CFG.WHATSAPP}" target="_blank" rel="noopener">Написать в WhatsApp</a>`);
  }

  // ---------- Заявки (для продавца, демо) ----------
  function openAdmin() {
    const leads = store.get("leads", []);
    const rows = leads.map((l) => `<tr>
      <td>${new Date(l.ts).toLocaleString("ru-RU")}</td>
      <td>${l.type === "order" ? "Заказ" : "Звонок"}</td>
      <td>${esc(l.name)}<br><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a><br>${esc(l.city)}</td>
      <td>${l.items.map((i) => `${esc(i.name)} ${esc(i.size)}×${i.qty}`).join("<br>")}</td>
      <td>${l.total ? rub(l.total) : ""}<br><small>${{ wholesale: "опт", qty: "от N шт", retail: "штучно" }[l.tier] || ""}</small></td>
      <td>${l.consent_ads ? "✅" : "—"}</td></tr>`).join("");
    showSheet(`
      <h2>Заявки</h2>
      <p class="muted">Демо: заявки с этого телефона/браузера. В боевой версии все заявки падают в Google-таблицу продавца.</p>
      ${leads.length ? `<div class="table-wrap"><table class="leads"><thead><tr><th>Когда</th><th>Тип</th><th>Клиент</th><th>Состав</th><th>Сумма</th><th>Рассылка</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p></p><button class="btn btn--block" id="csv">Скачать CSV для Excel</button>` : `<p>Пока пусто — оформите тестовый заказ.</p>`}`, (body) => {
      const b = body.querySelector("#csv");
      if (b) b.onclick = () => {
        const head = "Дата;Тип;Имя;Телефон;Город;Состав;Сумма;Цена;Согласие ПДн;Рассылка\n";
        const csv = head + leads.map((l) => [new Date(l.ts).toLocaleString("ru-RU"), l.type, l.name, l.phone, l.city,
          l.items.map((i) => `${i.name} ${i.size}x${i.qty}`).join(", "), l.total, l.tier, l.consent_pd ? "да" : "нет", l.consent_ads ? "да" : "нет"]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
        a.download = "zayavki.csv"; a.click();
      };
    }, () => { if (location.hash === "#admin") history.replaceState(null, "", location.pathname); });
  }

  // ---------- Нижний лист и тосты ----------
  let onCloseCb = null;
  function showSheet(html, init, onClose) {
    // Пересоздаём тело листа, чтобы сбросить обработчики от прошлого экрана
    const old = $("#sheetBody"), body = old.cloneNode(false);
    old.replaceWith(body);
    body.innerHTML = html;
    $("#sheet").hidden = false;
    document.body.style.overflow = "hidden";
    onCloseCb = onClose || null;
    init && init(body);
  }
  function closeSheet() {
    $("#sheet").hidden = true; document.body.style.overflow = "";
    onCloseCb && onCloseCb(); onCloseCb = null;
    renderGrid();
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
  }

  // ---------- Установка PWA ----------
  let installEvt;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#btnInstall").hidden = false; });
  $("#btnInstall").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; $("#btnInstall").hidden = true; };
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- События ----------
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const open = e.target.closest("[data-open]"); if (open) return openProduct(open.dataset.open);
    const chip = e.target.closest("[data-cat]"); if (chip) { state.cat = chip.dataset.cat; renderFilters(); renderGrid(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  $("#sizeFilter").onchange = (e) => { state.size = e.target.value; renderGrid(); };
  $("#stockOnly").onchange = (e) => { state.stockOnly = e.target.checked; renderGrid(); };
  $("#cartbar").onclick = openCart;
  $("#btnPlaces").onclick = openPlaces;
  $("#btnCallback").onclick = () => openForm("callback");
  $("#btnWa").href = `https://wa.me/${CFG.WHATSAPP}`;
  window.addEventListener("hashchange", () => location.hash === "#admin" && openAdmin());

  // ---------- Старт ----------
  $("#shopName").textContent = CFG.SHOP_NAME;
  $("#shopTag").textContent = CFG.SHOP_TAGLINE;
  loadCatalog().then(() => {
    renderFilters(); renderGrid(); renderCartbar();
    if (location.hash === "#admin") openAdmin();
  });
})();
