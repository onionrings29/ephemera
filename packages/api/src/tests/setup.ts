import { beforeAll, afterAll, afterEach, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

// Mock environment variables - must be set BEFORE importing db
process.env.DB_PATH = ":memory:";
process.env.PORT = "8286";
process.env.BASE_URL = "http://localhost:8286";
process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "test-secret-for-testing-only-not-production";

// Track if schema is initialized
let schemaInitialized = false;

// Global test setup
beforeAll(async () => {
  if (!schemaInitialized) {
    // Create minimal schema needed for OIDC tests
    // This avoids migration file conflicts from merged branches
    try {
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS sso_provider (
          id TEXT PRIMARY KEY,
          issuer TEXT NOT NULL,
          oidc_config TEXT,
          saml_config TEXT,
          user_id TEXT,
          provider_id TEXT NOT NULL UNIQUE,
          organization_id TEXT,
          domain TEXT NOT NULL DEFAULT '',
          name TEXT,
          allow_auto_provision INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER,
          updated_at INTEGER
        )
      `);

      schemaInitialized = true;
      console.log("[Test Setup] Database schema initialized");
    } catch (error) {
      console.error("[Test Setup] Schema initialization failed:", error);
      throw error;
    }
  }
});

// Clean up database between tests
beforeEach(async () => {
  if (schemaInitialized) {
    await db.run(sql`DELETE FROM sso_provider`);
  }
});

afterAll(() => {
  // Cleanup code that runs once after all tests
});

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});
