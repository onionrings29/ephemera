import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { testClient } from "hono/testing";
import crypto from "node:crypto";
import oidcProvidersRoutes from "../routes/oidc-providers.js";
import { db } from "../db/index.js";
import { ssoProvider } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Mock fetch for discovery document requests
globalThis.fetch = vi.fn();

describe("OIDC Providers API", () => {
  const client = testClient(oidcProvidersRoutes);
  const testProviderId = "test-provider";
  const testIssuer = "https://id.example.com";
  const testDiscoveryUrl = `${testIssuer}/.well-known/openid-configuration`;

  const mockDiscoveryDoc = {
    issuer: testIssuer,
    authorization_endpoint: `${testIssuer}/authorize`,
    token_endpoint: `${testIssuer}/token`,
    userinfo_endpoint: `${testIssuer}/userinfo`,
    jwks_uri: `${testIssuer}/jwks`,
  };

  beforeEach(async () => {
    // Database cleanup is handled in global setup
    // Reset fetch mock
    vi.mocked(fetch).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /", () => {
    it("should return empty array when no providers exist", async () => {
      const res = await client.index.$get();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });

    it("should return all providers with discoveryUrl converted from discoveryEndpoint", async () => {
      // Insert test provider
      const id = crypto.randomUUID();
      await db.insert(ssoProvider).values({
        id,
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        domain: "",
        allowAutoProvision: false,
        enabled: true,
        oidcConfig: JSON.stringify({
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid", "email"],
          discoveryEndpoint: testDiscoveryUrl,
          pkce: true,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await client.index.$get();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        enabled: true,
      });
      // Check that discoveryEndpoint was converted to discoveryUrl
      expect(data[0].oidcConfig.discoveryUrl).toBe(testDiscoveryUrl);
      expect(data[0].oidcConfig.discoveryEndpoint).toBeUndefined();
    });
  });

  describe("POST /", () => {
    it("should create a new provider with valid discovery document", async () => {
      // Mock successful discovery document fetch
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiscoveryDoc,
      } as Response);

      const createData = {
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        discoveryUrl: testDiscoveryUrl,
        clientId: "test-client",
        clientSecret: "test-secret",
        scopes: ["openid", "email", "profile"],
        allowAutoProvision: false,
        enabled: true,
      };

      const res = await client.index.$post({
        json: createData,
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data).toMatchObject({
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        enabled: true,
      });

      // Verify oidcConfig has correct structure
      expect(data.oidcConfig).toMatchObject({
        clientId: "test-client",
        scopes: ["openid", "email", "profile"],
        pkce: true,
      });

      // Verify discoveryEndpoint was converted to discoveryUrl in response
      expect(data.oidcConfig.discoveryUrl).toBe(testDiscoveryUrl);

      // Verify it was stored in database
      const stored = await db
        .select()
        .from(ssoProvider)
        .where(eq(ssoProvider.providerId, testProviderId))
        .limit(1);

      expect(stored).toHaveLength(1);
      const storedConfig = JSON.parse(stored[0].oidcConfig || "{}");
      expect(storedConfig.discoveryEndpoint).toBe(testDiscoveryUrl);
    });

    it("should reject duplicate provider IDs", async () => {
      // Create first provider
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiscoveryDoc,
      } as Response);

      await client.index.$post({
        json: {
          providerId: testProviderId,
          issuer: testIssuer,
          discoveryUrl: testDiscoveryUrl,
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid"],
        },
      });

      // Try to create duplicate
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiscoveryDoc,
      } as Response);

      const res = await client.index.$post({
        json: {
          providerId: testProviderId,
          issuer: "https://other.example.com",
          discoveryUrl:
            "https://other.example.com/.well-known/openid-configuration",
          clientId: "other-client",
          clientSecret: "other-secret",
          scopes: ["openid"],
        },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("already exists");
    });

    it("should reject invalid discovery document", async () => {
      // Mock discovery doc with missing required fields
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issuer: testIssuer,
          // Missing authorization_endpoint and token_endpoint
        }),
      } as Response);

      const res = await client.index.$post({
        json: {
          providerId: testProviderId,
          issuer: testIssuer,
          discoveryUrl: testDiscoveryUrl,
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid"],
        },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("missing required endpoints");
    });

    it("should handle discovery document fetch failure", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const res = await client.index.$post({
        json: {
          providerId: testProviderId,
          issuer: testIssuer,
          discoveryUrl: testDiscoveryUrl,
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid"],
        },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Failed to fetch discovery document");
    });
  });

  describe("PATCH /:id", () => {
    let providerId: string;

    beforeEach(async () => {
      // Create a test provider
      providerId = crypto.randomUUID();
      await db.insert(ssoProvider).values({
        id: providerId,
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        domain: "",
        allowAutoProvision: false,
        enabled: true,
        oidcConfig: JSON.stringify({
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid", "email"],
          discoveryEndpoint: testDiscoveryUrl,
          authorizationEndpoint: mockDiscoveryDoc.authorization_endpoint,
          tokenEndpoint: mockDiscoveryDoc.token_endpoint,
          pkce: true,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should update provider configuration", async () => {
      const res = await client[":id"].$patch({
        param: { id: providerId },
        json: {
          name: "Updated Name",
          enabled: false,
        },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.name).toBe("Updated Name");
      expect(data.enabled).toBe(false);
    });

    it("should fetch new discovery document when discoveryUrl changes", async () => {
      const newDiscoveryUrl =
        "https://new.example.com/.well-known/openid-configuration";
      const newMockDiscoveryDoc = {
        ...mockDiscoveryDoc,
        issuer: "https://new.example.com",
        authorization_endpoint: "https://new.example.com/authorize",
        token_endpoint: "https://new.example.com/token",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => newMockDiscoveryDoc,
      } as Response);

      const res = await client[":id"].$patch({
        param: { id: providerId },
        json: {
          discoveryUrl: newDiscoveryUrl,
        },
      });

      expect(res.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(newDiscoveryUrl);

      const data = await res.json();
      expect(data.oidcConfig.discoveryUrl).toBe(newDiscoveryUrl);
    });

    it("should not fetch discovery document when discoveryUrl is unchanged", async () => {
      const res = await client[":id"].$patch({
        param: { id: providerId },
        json: {
          name: "Updated Name",
        },
      });

      expect(res.status).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should return 404 for non-existent provider", async () => {
      const res = await client[":id"].$patch({
        param: { id: "non-existent-id" },
        json: {
          name: "Updated",
        },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /:id", () => {
    let providerId: string;

    beforeEach(async () => {
      // Create a test provider
      providerId = crypto.randomUUID();
      await db.insert(ssoProvider).values({
        id: providerId,
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        domain: "",
        allowAutoProvision: false,
        enabled: true,
        oidcConfig: JSON.stringify({
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid"],
          discoveryEndpoint: testDiscoveryUrl,
          pkce: true,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should delete an existing provider", async () => {
      const res = await client[":id"].$delete({
        param: { id: providerId },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify deletion
      const remaining = await db
        .select()
        .from(ssoProvider)
        .where(eq(ssoProvider.id, providerId));

      expect(remaining).toHaveLength(0);
    });

    it("should return 404 when deleting non-existent provider", async () => {
      const res = await client[":id"].$delete({
        param: { id: "non-existent-id" },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/test", () => {
    let providerId: string;

    beforeEach(async () => {
      // Create a test provider
      providerId = crypto.randomUUID();
      await db.insert(ssoProvider).values({
        id: providerId,
        providerId: testProviderId,
        name: "Test Provider",
        issuer: testIssuer,
        domain: "",
        allowAutoProvision: false,
        enabled: true,
        oidcConfig: JSON.stringify({
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid"],
          discoveryEndpoint: testDiscoveryUrl,
          pkce: true,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should successfully test valid provider", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiscoveryDoc,
      } as Response);

      const res = await client[":id"].test.$post({
        param: { id: providerId },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain("valid");
    });

    it("should report failure when discovery endpoint is unreachable", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const res = await client[":id"].test.$post({
        param: { id: providerId },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("500");
    });

    it("should report failure when discovery response is invalid", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issuer: testIssuer,
          // Missing required endpoints
        }),
      } as Response);

      const res = await client[":id"].test.$post({
        param: { id: providerId },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("missing required endpoints");
    });

    it("should return 404 for non-existent provider", async () => {
      const res = await client[":id"].test.$post({
        param: { id: "non-existent-id" },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("Field name consistency", () => {
    it("should store discoveryEndpoint internally but expose discoveryUrl to frontend", async () => {
      // Mock discovery fetch
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiscoveryDoc,
      } as Response);

      // Create provider
      const createRes = await client.index.$post({
        json: {
          providerId: testProviderId,
          issuer: testIssuer,
          discoveryUrl: testDiscoveryUrl,
          clientId: "test-client",
          clientSecret: "test-secret",
          scopes: ["openid"],
        },
      });

      expect(createRes.status).toBe(201);

      // Check database storage uses discoveryEndpoint
      const stored = await db
        .select()
        .from(ssoProvider)
        .where(eq(ssoProvider.providerId, testProviderId))
        .limit(1);

      const storedConfig = JSON.parse(stored[0].oidcConfig || "{}");
      expect(storedConfig.discoveryEndpoint).toBe(testDiscoveryUrl);
      expect(storedConfig.discoveryUrl).toBeUndefined();

      // Check API response exposes discoveryUrl
      const createData = await createRes.json();
      expect(createData.oidcConfig.discoveryUrl).toBe(testDiscoveryUrl);
      expect(createData.oidcConfig.discoveryEndpoint).toBeUndefined();

      // Check GET endpoint also exposes discoveryUrl
      const getRes = await client.index.$get();
      const getData = await getRes.json();
      expect(getData[0].oidcConfig.discoveryUrl).toBe(testDiscoveryUrl);
      expect(getData[0].oidcConfig.discoveryEndpoint).toBeUndefined();
    });
  });
});
