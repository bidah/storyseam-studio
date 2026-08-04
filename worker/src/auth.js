// Better Auth on Cloudflare (D1 + KV) — Google sign-in (+ legacy email/password
// and mobile's Higgsfield OAuth) + sessions, used to gate the app and scope
// projects per user. A fresh auth instance is created per request (Workers are
// stateless) with the request's cf context + origin.
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
        // "Sign in with Google" — the app login. Web + desktop authenticate
        // here; Higgsfield is no longer the front door, it's a CONNECTOR
        // linked from Settings (oauth2.link below) after the session exists.
        socialProviders: {
          google: {
            clientId: env?.GOOGLE_CLIENT_ID || "",
            clientSecret: env?.GOOGLE_CLIENT_SECRET || "",
            prompt: "select_account",
          },
        },
        account: {
          accountLinking: {
            enabled: true,
            trustedProviders: ["google"],
            // The Higgsfield connector links to whatever session is signed in;
            // its account email rarely matches the Google one, so don't require
            // it to. (Linking still requires the live session — Settings-only.)
            allowDifferentEmails: true,
          },
        },
        trustedOrigins: [
          baseURL,
          "http://localhost:3333",
          // The app's own domain, and the workers.dev origin it moved off. The
          // old one stays trusted on purpose: sessions issued there are still
          // live, and installed desktop builds still reach the Worker that way.
          "https://storyseam.app",
          "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev",
          // The Expo mobile app (scheme + dev-client URLs).
          "mobileapp://",
          "exp://",
        ].filter(Boolean),
        rateLimit: { enabled: true, window: 60, max: 100 },
        // Higgsfield OAuth — the same OAuth server the render skills use, so
        // one link yields the per-user Higgsfield token (stored on the account
        // row's accessToken). On web this is a Settings connector (linked to
        // the Google-signed-in user via /api/auth/oauth2/link); the mobile app
        // still signs in with it directly.
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
