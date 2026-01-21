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
      // Scores table with raw_score and final_score for referral boost
      await client.execute(`
        CREATE TABLE IF NOT EXISTS scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          address TEXT NOT NULL,
          score INTEGER NOT NULL,
          raw_score INTEGER,
          final_score INTEGER,
          boost_multiplier REAL DEFAULT 1.0,
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
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_scores_final_score ON scores (final_score);`
      );

      // Hint purchases
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

      // GM Streaks
      await client.execute(`
        CREATE TABLE IF NOT EXISTS gm_streaks (
          address TEXT PRIMARY KEY,
          streak INTEGER NOT NULL DEFAULT 0,
          last_checkin_utc INTEGER NOT NULL DEFAULT 0
        );
      `);

      // Referral codes (user_id -> code mapping)
      await client.execute(`
        CREATE TABLE IF NOT EXISTS referral_codes (
          user_id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes (code);`
      );

      // Referrals (inviter -> invitee binding)
      await client.execute(`
        CREATE TABLE IF NOT EXISTS referrals (
          inviter_user_id TEXT NOT NULL,
          invitee_user_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          activated_at INTEGER
        );
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_user_id);`
      );

      // Referral boosts (cached boost multiplier per user)
      await client.execute(`
        CREATE TABLE IF NOT EXISTS referral_boosts (
          user_id TEXT PRIMARY KEY,
          multiplier REAL NOT NULL DEFAULT 1.0,
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // Add columns to scores if they don't exist (migration for existing DBs)
      try {
        await client.execute(`ALTER TABLE scores ADD COLUMN raw_score INTEGER;`);
      } catch { /* column already exists */ }
      try {
        await client.execute(`ALTER TABLE scores ADD COLUMN final_score INTEGER;`);
      } catch { /* column already exists */ }
      try {
        await client.execute(`ALTER TABLE scores ADD COLUMN boost_multiplier REAL DEFAULT 1.0;`);
      } catch { /* column already exists */ }
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
