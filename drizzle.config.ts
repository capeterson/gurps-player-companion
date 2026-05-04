import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://gurps:gurps@localhost:5432/gurps';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
