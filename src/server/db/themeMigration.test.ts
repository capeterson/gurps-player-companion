import { expect, it } from 'bun:test';
import { Pool } from 'pg';

it.skipIf(!process.env.DATABASE_URL)('resets retired palettes only once', async () => {
  const migration = await Bun.file(
    new URL('./migrations/0077_solar_glass_themes.sql', import.meta.url),
  ).text();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // A temporary users table shadows the real table only on this connection.
    await client.query(`CREATE TEMP TABLE users (
      id int PRIMARY KEY,
      dark_theme varchar(32) NOT NULL DEFAULT 'gilded-tome'
        CONSTRAINT users_dark_theme_check CHECK (dark_theme IN ('gilded-tome', 'midnight-gilt')),
      light_theme varchar(32) NOT NULL DEFAULT 'sunbolt'
        CONSTRAINT users_light_theme_check CHECK (light_theme IN ('sunbolt', 'heraldic-vellum'))
    )`);
    await client.query(
      "INSERT INTO users VALUES (1, DEFAULT, DEFAULT), (2, 'midnight-gilt', 'heraldic-vellum')",
    );
    await client.query(migration);
    await client.query('INSERT INTO users (id) VALUES (3)');
    const selections = 'SELECT dark_theme, light_theme FROM users ORDER BY id';
    const defaults = { dark_theme: 'corona-obsidian', light_theme: 'heliolance' };
    expect((await client.query(selections)).rows).toEqual([defaults, defaults, defaults]);

    await client.query("UPDATE users SET light_theme = 'daybreak-lens' WHERE id = 2");
    await client.query(migration);
    expect((await client.query(selections)).rows).toEqual([
      defaults,
      { ...defaults, light_theme: 'daybreak-lens' },
      defaults,
    ]);
    await expect(
      client.query("UPDATE users SET dark_theme = 'midnight-gilt'"),
    ).rejects.toMatchObject({
      code: '23514',
    });
    await expect(client.query("UPDATE users SET light_theme = 'sunbolt'")).rejects.toMatchObject({
      code: '23514',
    });
  } finally {
    client.release(true);
    await pool.end();
  }
});
