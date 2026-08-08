import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import DatabaseConstructor, { type Database } from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function getDbPath(): string {
  const dbUrl = process.env.DATABASE_URL ?? 'file:/data/db/pde.db'
  // Strip "file:" prefix to get raw filesystem path
  return dbUrl.replace(/^file:/, '')
}

function ensureDbDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function initializeSchema(db: Database): void {
  // Create all tables if they don't exist - matches prisma/schema.prisma
  db.exec(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "spotifyId" TEXT,
      "spotifyUsername" TEXT,
      "spotifyEmail" TEXT,
      "isAdmin" BOOLEAN NOT NULL DEFAULT 0,
      "approved" BOOLEAN NOT NULL DEFAULT 0,
      "tokenVersion" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "KnownArtist" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "artistName" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "signals" TEXT NOT NULL DEFAULT '{}',
      "lastSeenAt" DATETIME,
      CONSTRAINT "KnownArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      UNIQUE("userId", "artistName")
    );

    CREATE TABLE IF NOT EXISTS "AppConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "aiProvider" TEXT,
      "aiModel" TEXT,
      "aiKeyData" TEXT,
      "rpm" INTEGER NOT NULL DEFAULT 5,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "Settings" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL UNIQUE,
      "spotifyAccessToken" TEXT,
      "spotifyRefreshToken" TEXT,
      "theme" TEXT NOT NULL DEFAULT 'analog-hifi',
      "obscurityLevel" INTEGER NOT NULL DEFAULT 3,
      "outputFormat" TEXT NOT NULL DEFAULT 'tracks',
      "recommendationLimit" INTEGER NOT NULL DEFAULT 20,
      "requestsPerMinute" INTEGER NOT NULL DEFAULT 5,
      "spotifyPlaylistPublic" BOOLEAN NOT NULL DEFAULT 1,
      "spotifySources" TEXT NOT NULL DEFAULT 'all',
      "tasteFocus" TEXT NOT NULL DEFAULT 'automatic',
      "genres" TEXT NOT NULL DEFAULT '[]',
      "discoveryMode" TEXT NOT NULL DEFAULT 'deep-roots',
      "rabbitHoleArtist" TEXT,
      "preferredProvider" TEXT,
      "preferredModel" TEXT,
      "scheduleEnabled" BOOLEAN NOT NULL DEFAULT 0,
      "scheduleInterval" TEXT NOT NULL DEFAULT 'daily',
      "scheduleHour" INTEGER NOT NULL DEFAULT 8,
      "scheduleDay" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );

    DROP TABLE IF EXISTS "StreamingHistory";
    DROP TABLE IF EXISTS "ProviderKey";
  `);

  // ── Legacy DB migration ──────────────────────────────────────────────────
  // The rethink replaced password auth with Spotify-identity auth and dropped
  // the streaming-history model entirely. Pre-rethink DBs still carry the old
  // columns; rebuild the User table (preserving ids so every FK stays valid)
  // and drop the dead history table. SQLite won't let us ALTER-drop the old
  // `username UNIQUE` column, hence the table rebuild.
  const userCols = (db.prepare(`PRAGMA table_info("User")`).all() as { name: string }[]).map(c => c.name);
  if (userCols.includes('username') || userCols.includes('passwordHash')) {
    // foreign_keys is a no-op inside a transaction, so do this outside the
    // BEGIN/COMMIT below. PRAGMA cannot be prepared, hence exec + a rebuild.
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`
      CREATE TABLE "User_new" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spotifyId" TEXT,
        "spotifyUsername" TEXT,
        "spotifyEmail" TEXT,
        "isAdmin" BOOLEAN NOT NULL DEFAULT 0,
        "approved" BOOLEAN NOT NULL DEFAULT 0,
        "tokenVersion" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      INSERT INTO "User_new" ("id", "spotifyUsername", "isAdmin", "tokenVersion", "createdAt", "updatedAt")
        SELECT "id", "username", "isAdmin", "tokenVersion", "createdAt", "updatedAt" FROM "User";
      DROP TABLE "User";
      ALTER TABLE "User_new" RENAME TO "User";
    `);
    db.exec(`PRAGMA foreign_keys = ON`);
  }
  // Fresh tables already carry the new columns; rebuilt ones get them from
  // the CREATE above. Either way the unique index must exist for findUnique.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "User_spotifyId_key" ON "User"("spotifyId");`);

  // ── Column additions for tables that predate a given field ────────────────
  db.exec(`BEGIN;`);
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "requestsPerMinute" INTEGER NOT NULL DEFAULT 5;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "spotifyPlaylistPublic" BOOLEAN NOT NULL DEFAULT 1;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "spotifySources" TEXT NOT NULL DEFAULT 'all';`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "tasteFocus" TEXT NOT NULL DEFAULT 'automatic';`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "genres" TEXT NOT NULL DEFAULT '[]';`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "discoveryMode" TEXT NOT NULL DEFAULT 'deep-roots';`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "rabbitHoleArtist" TEXT;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "preferredProvider" TEXT;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "preferredModel" TEXT;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT 0;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "scheduleInterval" TEXT NOT NULL DEFAULT 'daily';`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "scheduleHour" INTEGER NOT NULL DEFAULT 8;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "scheduleDay" INTEGER NOT NULL DEFAULT 1;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "KnownArtist" ADD COLUMN "signals" TEXT NOT NULL DEFAULT '{}';`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "KnownArtist" ADD COLUMN "lastSeenAt" DATETIME;`);
  } catch { /* Column already exists */ }
  db.exec(`COMMIT;`);
}

function createPrismaClient(): PrismaClient {
  const dbPath = getDbPath()
  ensureDbDirectory(dbPath)
  
  const db = new DatabaseConstructor(dbPath, { timeout: 10000 })
  db.pragma('busy_timeout = 10000')
  // WAL mode caused SQLITE_IOERR_SHORT_READ on the proxy worker's connection
  // after large multi-chunk uploads: the route handler's writes trigger
  // auto-checkpoints that corrupt the other worker's read snapshot. The plain
  // rollback journal coordinates readers/writers via file locks instead of
  // shared memory, which is reliable here (single-user, per-chunk commits).
  db.pragma('journal_mode = DELETE')
  db.pragma('foreign_keys = ON')
  
  // Initialize schema directly - no prisma CLI needed
  try {
    initializeSchema(db)
  } catch {
    // Ignore if already initialized by another worker
  }
  
  const adapter = new PrismaBetterSqlite3({ url: dbPath })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
