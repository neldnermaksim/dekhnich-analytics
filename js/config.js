// Настройки дашборда. Меняются здесь, остальной код трогать не нужно.
window.CONFIG = {
  // Откуда берутся данные: веб-приложение Google Apps Script при таблице аналитики.
  // Оно отдаёт сводные цифры (без Telegram ID и личных данных) и обновляется раз в час вместе с таблицей.
  API_URL: 'https://script.google.com/macros/s/AKfycbyJEzQS7x6gNXZ8JCIJtgOlGfAmkIz-dhT-lHyEed-5rVgja0elGAvY9ovTWZtsI-rS/exec?api=dashboard',

  // Таблица аналитики (кнопка «Открыть таблицу» в шапке).
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1eKh5ZQKbWxMu6qJO9GClBh22b5ce52dA9VO3mUikkZo/edit',

  TITLE: 'Маркетинговая аналитика',
  LOGO: 'D+',

  // Сколько строк в «топах».
  TOP_N: 10,

  // Период по умолчанию при открытии: 'month' — текущий месяц, '30' — последние 30 дней, 'all' — всё время.
  DEFAULT_PERIOD: 'month',

  // Сколько минут показывать сохранённые данные, если таблица не ответила (например, нет интернета).
  CACHE_MINUTES: 60 * 24,
};
