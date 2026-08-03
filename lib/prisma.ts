import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import DatabaseConstructor, { type Database } from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function getDbPath(): string {
  const dbUrl = process.env.DATABASE_URL ?? 'file:/config/pde.db'
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
      "username" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "isAdmin" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "ProviderKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "provider" TEXT NOT NULL,
      "keyData" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ProviderKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      UNIQUE("userId", "provider")
    );

    CREATE TABLE IF NOT EXISTS "StreamingHistory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "source" TEXT NOT NULL,
      "artistName" TEXT NOT NULL,
      "trackName" TEXT NOT NULL,
      "albumName" TEXT,
      "playedAt" DATETIME NOT NULL,
      "userId" TEXT NOT NULL,
      CONSTRAINT "StreamingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE INDEX IF NOT EXISTS "StreamingHistory_userId_artistName_idx" 
      ON "StreamingHistory"("userId", "artistName");

    CREATE TABLE IF NOT EXISTS "KnownArtist" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "artistName" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "KnownArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      UNIQUE("userId", "artistName")
    );

    CREATE TABLE IF NOT EXISTS "Settings" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL UNIQUE,
      "spotifyAccessToken" TEXT,
      "spotifyRefreshToken" TEXT,
      "lastFmUsername" TEXT,
      "theme" TEXT NOT NULL DEFAULT 'analog-hifi',
      "obscurityLevel" INTEGER NOT NULL DEFAULT 3,
      "outputFormat" TEXT NOT NULL DEFAULT 'tracks',
      "recommendationLimit" INTEGER NOT NULL DEFAULT 20,
      "requestsPerMinute" INTEGER NOT NULL DEFAULT 0,
      "spotifyPlaylistPublic" BOOLEAN NOT NULL DEFAULT 1,
      "scheduleMode" TEXT NOT NULL DEFAULT 'manual',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );

    -- Auto-migrate column if db was created before this field was added
    BEGIN;
  `);
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "requestsPerMinute" INTEGER NOT NULL DEFAULT 0;`);
  } catch { /* Column already exists */ }
  try {
    db.exec(`ALTER TABLE "Settings" ADD COLUMN "spotifyPlaylistPublic" BOOLEAN NOT NULL DEFAULT 1;`);
  } catch { /* Column already exists */ }
  db.exec(`COMMIT;`);
}

function createPrismaClient(): PrismaClient {
  const dbPath = getDbPath()
  ensureDbDirectory(dbPath)
  
  const db = new DatabaseConstructor(dbPath, { timeout: 10000 })
  db.pragma('busy_timeout = 10000')
  // Enable WAL mode for better concurrent read performance
  try {
    db.pragma('journal_mode = WAL')
  } catch {
    // Ignore if locked by concurrent process
  }
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
