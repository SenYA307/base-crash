import { createClient, type Client } from "@libsql/client";

let dbInstance: Client | null = null;
let initPromise: Promise<void> | null = null;

function getDbConfig() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set for database access"
    );
  }

  return { url, authToken };
}

async function ensureInitialized(client: Client) {
  if (!initPromise) {
    initPromise = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          address TEXT NOT NULL,
          score INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          game_version TEXT,
          duration_ms INTEGER,
          moves_used INTEGER,
          hints_used INTEGER
        );
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_scores_created_at ON scores (created_at);`
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score);`
      );

      await client.execute(`
        CREATE TABLE IF NOT EXISTS hint_purchases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          address TEXT NOT NULL,
          run_id TEXT NOT NULL,
          tx_hash TEXT NOT NULL UNIQUE,
          added_hints INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_hint_purchases_address_run ON hint_purchases (address, run_id);`
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_hint_purchases_tx_hash ON hint_purchases (tx_hash);`
      );
    })();
  }

  await initPromise;
}

export async function getDb() {
  if (!dbInstance) {
    const { url, authToken } = getDbConfig();
    dbInstance = createClient({ url, authToken });
  }

  await ensureInitialized(dbInstance);
  return dbInstance;
}
