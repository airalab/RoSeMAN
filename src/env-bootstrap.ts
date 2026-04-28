import dotenv from 'dotenv';

/**
 * Каскадная загрузка env-файлов.
 *
 * Должен импортироваться **первым** side-effect импортом в `main.ts`,
 * чтобы выполниться ДО загрузки `AppModule` (в ESM side-effect imports
 * исполняются в топологическом порядке — leaves first). Если вызов
 * `dotenv.config()` разместить в теле `main.ts`, он выполнится позже
 * `ConfigModule.forRoot()`, который читает `.env` при evaluation декоратора
 * `AppModule` — и наш override на `DOTENV_CONFIG_PATH` не успеет сработать.
 *
 * Порядок:
 * 1. Сначала читается общий `.env` (база).
 * 2. Затем (если задан `DOTENV_CONFIG_PATH`) — указанный файл с `override: true`,
 *    перезаписывая пересекающиеся переменные.
 */
dotenv.config();
if (process.env.DOTENV_CONFIG_PATH) {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: true });
}
