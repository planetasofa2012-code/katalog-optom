# 7. Деплой

- **Хостинг:** GitHub Pages, репозиторий https://github.com/planetasofa2012-code/katalog-optom, ветка `main`, папка `/docs`
- **Адрес:** https://planetasofa2012-code.github.io/katalog-optom/
- **Выкладка:** `git push` → Pages пересобирает сам (~1 мин)
- **Env:** нет. Публичные настройки — `docs/config.js` (номер WhatsApp, URL таблицы, URL Apps Script)
- **Бэкапы:** код — git; заявки (v2) — Google-таблица, раз в неделю «Файл → Скачать → xlsx»
- **Откат:** `git revert <коммит> && git push`

## Журнал
| Дата | Что ушло | Проверка |
|------|----------|----------|
| 2026-10-16 | Демо-каталог v0.1 | 200 OK, автотест на живом адресе без ошибок |
