// Better Auth on Cloudflare (D1 + KV) — email/password login + sessions, used to
// gate the app and scope projects per user. A fresh auth instance is created per
// request (Workers are stateless) with the request's cf context + origin.
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { withCloudflare } from "better-auth-cloudflare";
import { expo } from "@better-auth/expo";

// Higgsfield has no userinfo endpoint — identity comes from the OIDC id_token.
// Decode the JWT payload (base64url → JSON), padding + UTF-8-safe for workerd.
function decodeIdToken(idToken) {
  let part = String(idToken || "").split(".")[1] || "";
  part = part.replace(/-/g, "+").replace(/_/g, "/");
  while (part.length % 4) part += "=";
  const bin = atob(part);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

export function createAuth(env, cf, baseURL) {
  return betterAuth({
    baseURL,
    secret: env?.BETTER_AUTH_SECRET,
    ...withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: false,
        cf: cf || {},
        d1Native: env?.DB,
        kv: env?.AUTH_KV,
      },
      {
        emailAndPassword: {
          enabled: true,
          // No email provider wired yet — let users in immediately after sign-up.
          requireEmailVerification: false,
        },
        trustedOrigins: [
          baseURL,
          "http://localhost:3333",
          "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev",
          // The Expo mobile app (scheme + dev-client URLs).
          "mobileapp://",
          "exp://",
        ].filter(Boolean),
        rateLimit: { enabled: true, window: 60, max: 100 },
        // "Sign in with Higgsfield" — the same OAuth server the render skills
        // use, so one login yields both the app account AND the per-user
        // Higgsfield token (stored on the account row's accessToken).
        plugins: [
          // Lets the Expo app authenticate: accepts the mobile scheme origin,
          // returns the session cookie in a way the RN client can persist.
          expo(),
          genericOAuth({
            config: [
              {
                providerId: "higgsfield",
                clientId: env?.HIGGSFIELD_CLIENT_ID || "",
                clientSecret: "", // public client (PKCE, token_endpoint_auth_method=none)
                authorizationUrl: "https://mcp.higgsfield.ai/oauth2/authorize",
                tokenUrl: "https://mcp.higgsfield.ai/oauth2/token",
                scopes: ["openid", "email", "offline_access"],
                pkce: true,
                getUserInfo: async (tokens) => {
                  try {
                    console.log("[hf] getUserInfo tokens keys:", Object.keys(tokens || {}).join(","), "| hasIdToken:", !!(tokens.idToken || tokens.id_token));
                    const claims = decodeIdToken(tokens.idToken || tokens.id_token);
                    console.log("[hf] claims:", JSON.stringify({ sub: claims.sub, email: claims.email }));
                    return {
                      id: claims.sub,
                      email: claims.email || `${claims.sub}@higgsfield.local`,
                      emailVerified: Boolean(claims.email_verified),
                      name: claims.name || claims.email || "Higgsfield user",
                      image: claims.picture || null,
                    };
                  } catch (e) {
                    console.log("[hf] getUserInfo ERROR:", String(e && (e.stack || e.message || e)));
                    throw e;
                  }
                },
              },
            ],
          }),
        ],
      },
    ),
  });
}
