import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import crypto from "node:crypto";
import { db } from "./db/index.js";
import { booklorePlugin } from "./auth/plugins/booklore-plugin.js";
import { calibrePlugin } from "./auth/plugins/calibre-plugin.js";
import { config } from "./config.js";

/**
 * Get baseURL for Better Auth
 * Checks environment variable first, then falls back to runtime config from database
 * NOTE: This is synchronous to work with Better Auth initialization
 * The actual runtime value from database will be used by getRuntimeConfig()
 */
function getAuthBaseUrl(): string {
  return process.env.BASE_URL || "http://localhost:8286";
}

/**
 * Get trusted origins for Better Auth
 * In development: includes dev server origins
 * In production: use BASE_URL or environment ALLOWED_ORIGINS if set
 */
function getAuthTrustedOrigins(): string[] {
  const baseUrl = getAuthBaseUrl();
  const origins = [baseUrl];

  // Add dev origins in development mode
  if (!config.isProduction) {
    origins.push(...config.devOrigins);
  }

  // Add any explicitly configured origins from environment
  if (process.env.ALLOWED_ORIGINS) {
    const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    origins.push(...envOrigins);
  }

  return [...new Set(origins)]; // Remove duplicates
}

/**
 * Determine if cookies should be secure
 * Based on BASE_URL protocol or NODE_ENV
 */
function shouldUseSecureCookies(): boolean {
  const baseUrl = getAuthBaseUrl();
  return baseUrl.startsWith('https://') || config.isProduction;
}

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: getAuthBaseUrl(),
  trustedOrigins: getAuthTrustedOrigins(),

  // Cookie configuration for cross-origin setup (dev) and same-origin (prod)
  cookie: {
    sameSite: "lax", // Allow cookies to be sent on redirects (critical for OIDC)
    secure: shouldUseSecureCookies(), // Dynamic based on BASE_URL protocol
    httpOnly: true,
    path: "/",
    // Don't set domain - let browser handle it (works for both localhost and production)
  },

  database: drizzleAdapter(db, {
    provider: "sqlite",
  }),

  // Basic email/password auth
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    // Cookie cache disabled - causes stale session data after OIDC redirect
    // React Query's 30s cache provides sufficient performance optimization
  },

  // Rate limiting
  rateLimit: {
    enabled: true,
    window: 60, // 1 minute
    max: 10, // 10 requests per minute
  },

  // Advanced configuration
  advanced: {
    database: {
      generateId: () => {
        // Use crypto.randomUUID for better IDs
        return crypto.randomUUID();
      },
    },
  },

  plugins: [
    // Admin plugin for role-based access
    admin({
      defaultRole: "user",
    }),

    // Custom credential plugins
    booklorePlugin,
    calibrePlugin,

    // SSO plugin for database-stored OIDC providers
    sso({
      organizationProvisioning: {
        disabled: true, // We don't need organization features
        defaultRole: "member",
      },
      defaultOverrideUserInfo: true, // Update user info on each login
    }),
  ],
});

export type Auth = typeof auth;
