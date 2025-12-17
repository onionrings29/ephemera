/**
 * Centralized Configuration Module
 *
 * This module provides a single source of truth for all configuration values.
 * BASE_URL is primarily stored in the database (via setup wizard) but can be
 * overridden with an environment variable for special deployments.
 */

import { db } from "./db/index.js";
import { appConfig } from "./db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Cache for database config to avoid repeated queries
 */
let configCache: {
  baseUrl?: string;
  allowedOrigins?: string[];
  lastFetch?: number;
} = {};

const CACHE_TTL = 5000; // 5 seconds

/**
 * Parse comma-separated origins from string
 */
function parseOrigins(origins?: string | null): string[] {
  if (!origins) return [];
  return origins.split(',').map(origin => origin.trim()).filter(Boolean);
}

/**
 * Check if BASE_URL uses HTTPS
 */
function isSecureUrl(url: string): boolean {
  return url.startsWith('https://');
}

/**
 * Check if we're in production mode
 */
function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Fetch configuration from database
 */
async function fetchDatabaseConfig(): Promise<{ baseUrl?: string; allowedOrigins?: string[] }> {
  try {
    const config = await db.query.appConfig.findFirst({
      where: eq(appConfig.id, 1),
    });

    return {
      baseUrl: config?.baseUrl || undefined,
      allowedOrigins: config?.allowedOrigins ? parseOrigins(config.allowedOrigins) : [],
    };
  } catch (error) {
    // Database might not be initialized yet (during migrations)
    console.warn('[Config] Could not fetch database config:', error);
    return {};
  }
}

/**
 * Get BASE_URL with fallback chain:
 * 1. Environment variable (if set)
 * 2. Database value (if set via setup wizard)
 * 3. Default localhost
 */
async function getBaseUrl(): Promise<string> {
  // Environment variable takes precedence (for special deployments)
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  // Check cache
  const now = Date.now();
  if (configCache.baseUrl && configCache.lastFetch && (now - configCache.lastFetch) < CACHE_TTL) {
    return configCache.baseUrl;
  }

  // Fetch from database
  const dbConfig = await fetchDatabaseConfig();
  if (dbConfig.baseUrl) {
    configCache.baseUrl = dbConfig.baseUrl;
    configCache.allowedOrigins = dbConfig.allowedOrigins;
    configCache.lastFetch = now;
    return dbConfig.baseUrl;
  }

  // Default fallback
  return 'http://localhost:8286';
}

/**
 * Get allowed origins with fallback chain
 */
async function getAllowedOrigins(): Promise<string[]> {
  // Check environment variable
  const envOrigins = process.env.ALLOWED_ORIGINS ? parseOrigins(process.env.ALLOWED_ORIGINS) : [];

  // Check cache
  const now = Date.now();
  if (configCache.allowedOrigins && configCache.lastFetch && (now - configCache.lastFetch) < CACHE_TTL) {
    return [...envOrigins, ...configCache.allowedOrigins];
  }

  // Fetch from database
  const dbConfig = await fetchDatabaseConfig();
  configCache.allowedOrigins = dbConfig.allowedOrigins;
  configCache.lastFetch = now;

  return [...envOrigins, ...(dbConfig.allowedOrigins || [])];
}

/**
 * Application configuration (static values)
 */
export const config = {
  port: parseInt(process.env.PORT || '8286', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Development-specific origins (always included in dev mode)
  devOrigins: [
    'http://localhost:5222', // Vite dev server (primary)
    'http://localhost:5223', // Vite dev server (backup port)
  ],

  get isProduction(): boolean {
    return isProductionMode();
  },
} as const;

/**
 * Get runtime configuration (async, reads from database)
 */
export async function getRuntimeConfig() {
  const baseUrl = await getBaseUrl();
  const customOrigins = await getAllowedOrigins();
  const isSecure = isSecureUrl(baseUrl);

  // Build allowed origins list
  const allowedOrigins = [baseUrl];
  if (!config.isProduction) {
    allowedOrigins.push(...config.devOrigins);
  }
  allowedOrigins.push(...customOrigins);

  // Remove duplicates
  const uniqueOrigins = [...new Set(allowedOrigins)];

  return {
    baseUrl,
    isSecure,
    allowedOrigins: uniqueOrigins,
    trustedOrigins: uniqueOrigins,
    cookieConfig: {
      secure: isSecure,
      sameSite: 'lax' as const,
      httpOnly: true,
      path: '/',
    },
  };
}

/**
 * Clear configuration cache (call this when config changes in database)
 */
export function clearConfigCache(): void {
  configCache = {};
}

/**
 * Validate configuration on startup
 */
export async function validateConfig(): Promise<void> {
  const errors: string[] = [];
  const runtimeConfig = await getRuntimeConfig();

  // Validate BASE_URL format
  if (!runtimeConfig.baseUrl.match(/^https?:\/\/.+/)) {
    errors.push('BASE_URL must be a valid HTTP(S) URL');
  }

  // Validate BASE_URL doesn't have trailing slash
  if (runtimeConfig.baseUrl.endsWith('/')) {
    errors.push('BASE_URL should not end with a trailing slash');
  }

  // Validate port
  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('PORT must be a valid port number (1-65535)');
  }

  // Warn if production mode without HTTPS
  if (config.isProduction && !runtimeConfig.isSecure) {
    console.warn('⚠️  WARNING: Running in production mode without HTTPS. Cookies will not be marked as secure.');
  }

  // Warn if no custom origins in production
  if (config.isProduction && runtimeConfig.allowedOrigins.length === 1) {
    console.warn('⚠️  WARNING: No additional origins configured. Only BASE_URL will be allowed for CORS.');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // Log configuration in development
  if (!config.isProduction) {
    console.log('📝 Configuration loaded:');
    console.log(`   BASE_URL: ${runtimeConfig.baseUrl}`);
    console.log(`   Allowed Origins: ${runtimeConfig.allowedOrigins.join(', ')}`);
    console.log(`   Secure Cookies: ${runtimeConfig.cookieConfig.secure}`);
  }
}
