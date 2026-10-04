# Чеклист запуска «Невидимка»

Команды выполняются из `nevidimka/`. Полная инструкция — `LAUNCH_GUIDE.md`.

## Обязательное для production

| Настройка | Требование |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Действующий токен BotFather |
| `OWNER_TELEGRAM_ID` | Ваш положительный числовой Telegram ID; бот и Mini App доступны только ему |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | Ключ с доступом к выбранной модели и доступным балансом |
| `DATABASE_URL` | Postgres-роль `NOSUPERUSER NOBYPASSRLS`, не владеющая таблицами с нефорсированным RLS |
| `SYSTEM_DATABASE_URL` | Отдельная роль для миграций, регистрации, напоминаний и очереди; `BYPASSRLS` или superuser |
| `JWT_SECRET` | Случайный секрет не короче 32 символов: `openssl rand -hex 32` |
| `APP_BASE_URL` | Реальный публичный HTTPS-адрес Mini App |
| `EVIDENCE_STORAGE_ROOT`, `VIDEO_STORAGE_ROOT` | Общие пути: evidence для bot/web, video для bot/worker/web |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | Для Compose: два отдельных случайных пароля, например `openssl rand -hex 32` |

Compose сам формирует две DB URL и создаёт ограниченную роль. Для внешнего Postgres роли, права и миграции нужно подготовить отдельно. Production проверяет реальные привилегии перед обслуживанием запросов.

`ALLOW_DEV_AUTH` и тестовые `*_API_BASE_URL` должны быть пустыми. Примерные токены и адреса из `.env.example` нужно заменить. Незаданного владельца нельзя использовать для открытия регистрации в production.

## Опциональное

- `ASR_API_KEY`: голосовые отчёты и субтитры. Без него расшифровка пропускается.
- Канал Telegram: подключается через настройки; боту нужны права публикации.
- Webhook: polling работает с пустыми `TELEGRAM_WEBHOOK_URL` и `TELEGRAM_WEBHOOK_SECRET`. Для webhook нужны публичный HTTPS URL с путём `/telegram/webhook` и секрет из 32–256 символов `[A-Za-z0-9_-]`.

Публичный HTTPS обязателен для production Mini App. Для локальной разработки бот может работать через polling, а web — на localhost.

## Проверки до запуска

- [ ] Root CI: typecheck/build/audit, полный Postgres/ffmpeg/Playwright suite и Docker smoke зелёные.
- [ ] Заполнен локальный `.env`; секреты не сохранены в git.
- [ ] HTTPS reverse proxy направляет Mini App в `127.0.0.1:3000`; при webhook его путь — в `127.0.0.1:3001`.
- [ ] `docker compose up -d --build`; bot/web/worker работают, migrate/db-bootstrap завершились успешно.
- [ ] `npm run smoke:integrations` проверяет настоящий Telegram token/webhook и делает небольшой платный запрос Anthropic.
- [ ] При включённом ASR: `npm run smoke:integrations -- --asr /path/to/test.ogg` делает платную реальную расшифровку, не печатая её содержание.
- [ ] В Telegram владельцем проверены `/start`, ежедневный цикл, Mini App и одна публикация в тестовый канал; чужой аккаунт не получает доступ.
- [ ] Проверены резервная копия Postgres и резервная копия обоих storage-томов.

Инфраструктурный smoke использует отдельный временный Compose project и удаляет только свои тома. Не запускайте `docker compose down -v` для рабочего проекта.
