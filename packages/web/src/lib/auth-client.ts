import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";

/**
 * Better Auth React client
 * Provides authentication state management and hooks
 */
export const authClient = createAuthClient({
  // In development, explicitly use the API server port
  // In production, use the same origin (frontend served from API server)
  baseURL: import.meta.env.DEV
    ? "http://localhost:8286"
    : window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [adminClient(), ssoClient()],
  // Disable session caching to prevent stale data after OIDC redirect
  // This ensures the session is always fresh, especially after SSO callbacks
  session: {
    cookieCache: {
      enabled: false, // Disable cookie cache - React Query handles caching
    },
  },
});

// Export hooks for use in components
export const { useSession, signIn, signOut, signUp, changePassword, $Infer } =
  authClient;

// Export types for convenience
export type Session = typeof $Infer.Session;
export type User = Session["user"];
