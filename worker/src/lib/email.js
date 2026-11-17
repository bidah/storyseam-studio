// Transactional email via the Cloudflare Email Sending binding (env.EMAIL).
//
// The `storyseam.app` domain is onboarded to Email Service, so SPF/DKIM/DMARC
// are handled for us and these land in inboxes rather than spam. This module is
// the ONLY place that composes outbound mail — routes call these helpers and
// never touch the binding directly.
//
// Sending is best-effort by design: an invite still exists in D1 and the
// creator still gets the `inviteUrl` back to share, so a failed send is not a
// failed invite. Callers may await (request-time) or fire-and-forget
// (ctx.waitUntil) — the helpers never throw past the caller.

const FROM = "team@storyseam.app";

// Escape a plain string for safe use inside HTML so a user-supplied org name
// can't inject markup into the invite mail.
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The app's look, as literal values: email clients can't read CSS variables,
// so these are the light theme's tokens from src/index.css (the default theme
// the homepage and studio open in) — white ground, zinc greys, hairline
// borders, ONE purple accent, nothing rounded. Inter Tight for display, Inter
// for body, JetBrains Mono for HUD labels; clients that block web fonts (Gmail)
// fall back to the system stack, which is the same fallback the app uses.
const T = {
  background: "#FFFFFF",
  foreground: "#19191A",
  muted: "#F4F4F5",
  mutedForeground: "#5B5B64",
  border: "#E2E2E4", // rgb(18 18 22 / 12%) flattened onto white
  primary: "#681DE4",
  primaryForeground: "#FAFAFA",
  display: "'Inter Tight', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  body: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
};

// A HUD label: mono, small, uppercase, wide-tracked, secondary (HudHeader's
// `Label`).
const label = (s, extra = "") =>
  `<span style="font-family:${T.mono};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${T.mutedForeground};${extra}">${s}</span>`;

// Build the shared jacket around the human-facing body: a plain-text version
// and an HTML version with a big CTA button. Keeps the two in lockstep so one
// never drifts. The HTML is the homepage in miniature: the STORYSEAM strip over
// a hairline rule, an uppercase display headline, a square primary button.
function enclosure({ orgName, eyebrow, heading, actionUrl, actionLabel, textBody, htmlBody, footerHtml }) {
  const safeOrg = esc(orgName || "your team on StorySeam");
  const footer = footerHtml ?? `You're invited to the <strong style="color:${T.foreground};font-weight:500;">${safeOrg}</strong> workspace on StorySeam. If you didn't expect this invitation, you can ignore this email — nothing will change until you accept.`;
  const text = `${heading}

${textBody}

${actionLabel}: ${actionUrl}

If you weren't expecting this, you can safely ignore it.`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Inter+Tight:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background:${T.muted};color:${T.foreground};font-family:${T.body};-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.muted};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${T.background};border:1px solid ${T.border};">
            <tr>
              <td style="padding:20px 32px;border-bottom:1px solid ${T.border};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family:${T.display};font-size:20px;line-height:1;font-weight:600;letter-spacing:-0.02em;color:${T.foreground};">STORY<span style="font-weight:800;">SEAM</span></td>
                    <td align="right">${label("Realtime storytelling")}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 32px;">
                ${eyebrow ? `<div style="margin:0 0 14px;">${label(esc(eyebrow), `color:${T.primary};`)}</div>` : ""}
                <h1 style="margin:0 0 20px;font-family:${T.display};font-size:30px;line-height:1.05;font-weight:700;letter-spacing:-0.02em;text-transform:uppercase;color:${T.foreground};">${esc(heading)}</h1>
                ${htmlBody}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                  <tr>
                    <td align="center" style="background:${T.primary};">
                      <a href="${esc(actionUrl)}" style="display:inline-block;padding:14px 28px;font-family:${T.mono};font-size:13px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${T.primaryForeground};text-decoration:none;">${esc(actionLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${T.mutedForeground};word-break:break-all;">Or open <a href="${esc(actionUrl)}" style="color:${T.primary};text-decoration:none;">${esc(actionUrl)}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${T.border};">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${T.mutedForeground};">${footer}</p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
            <tr>
              <td style="padding:16px 0 0;">${label("StorySeam · storyseam.app")}</td>
              <td align="right" style="padding:16px 0 0;">${label("Powered by: fal")}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { text, html };
}

// A body paragraph in the app's body face. `lead` is the first, darker line.
const para = (html, lead = false) =>
  `<p style="margin:0 0 12px;font-family:${T.body};font-size:15px;line-height:1.65;color:${lead ? T.foreground : T.mutedForeground};">${html}</p>`;
const strong = (s) => `<strong style="color:${T.foreground};font-weight:500;">${s}</strong>`;

// Send an org invitation to `email`. `inviteUrl` is the accept link minted by
// the route; `orgName` is the workspace they're being invited into.
export async function sendInviteEmail(env, { email, orgName, inviteUrl }) {
  if (!env?.EMAIL) return { sent: false, reason: "EMAIL binding not configured" };
  const { text, html } = enclosure({
    orgName,
    actionUrl: inviteUrl,
    eyebrow: "Team invitation",
    heading: "You're invited to the room",
    actionLabel: "Accept invitation",
    textBody: `${orgName} on StorySeam has invited you to collaborate. Click the link below to accept your invitation and sign in to the workspace.`,
    htmlBody: para(`You've been invited to join ${strong(esc(orgName || "a team"))} on StorySeam.`, true) + para("Accept your invitation to start making stories with the team — one prompt in, a film back."),
  });
  try {
    const res = await env.EMAIL.send({
      to: String(email).trim(),
      from: FROM,
      subject: `You're invited to ${orgName} on StorySeam`,
      text,
      html,
    });
    return { sent: true, messageId: res?.id || res?.messageId || null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("sendInviteEmail failed:", err?.code || err?.message || err);
    return { sent: false, reason: err?.code || "send_failed" };
  }
}
// The waitlist's "you're in" mail: a spot opened for `email`. There is no token
// in the link — access is keyed by the address itself (lib/waitlist.js), so the
// one thing the mail must say is to sign in with Google AS this address.
export async function sendWaitlistInviteEmail(env, { email, appUrl }) {
  if (!env?.EMAIL) return { sent: false, reason: "EMAIL binding not configured" };
  const to = String(email).trim();
  const { text, html } = enclosure({
    actionUrl: appUrl,
    eyebrow: "Off the waitlist",
    heading: "You're in. Your spot is ready",
    actionLabel: "Open StorySeam",
    textBody: `Your spot on StorySeam is ready. Sign in with Google using this address (${to}) and you can start making stories right away.`,
    htmlBody: para(`Your spot on ${strong("StorySeam")} is ready.`, true) + para(`Sign in with Google using ${strong(esc(to))} and you can start making stories right away — a prompt in, a film back.`),
    footerHtml: "You're getting this because you joined the StorySeam waitlist. If that wasn't you, you can ignore this email.",
  });
  try {
    const res = await env.EMAIL.send({
      to,
      from: FROM,
      subject: "You're in — your StorySeam spot is ready",
      text,
      html,
    });
    return { sent: true, messageId: res?.id || res?.messageId || null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("sendWaitlistInviteEmail failed:", err?.code || err?.message || err);
    return { sent: false, reason: err?.code || "send_failed" };
  }
}
