import { beforeAll, afterAll, afterEach, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../db/index.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Mock environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.env.DB_PATH = ":memory:";
process.env.PORT = "8286";
process.env.BASE_URL = "http://localhost:8286";
process.env.NODE_ENV = "test";

// Global test setup
beforeAll(async () => {
  // Run migrations to set up database schema
  const migrationsFolder = join(__dirname, "../db/migrations");
  migrate(db, { migrationsFolder });
});

afterAll(() => {
  // Cleanup code that runs once after all tests
});

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});
