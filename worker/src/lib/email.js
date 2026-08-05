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

const FROM = { email: "team@storyseam.app", name: "Storyseam" };

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

// Build the shared jacket around the human-facing body: a plain-text version
// and an HTML version with a big CTA button. Keeps the two in lockstep so one
// never drifts.
function enclosure({ orgName, actionUrl, actionLabel, textBody, htmlBody }) {
  const safeOrg = esc(orgName || "your team on Storyseam");
  const text = `${textBody}

${actionLabel}: ${actionUrl}

If you weren't expecting this, you can safely ignore it.`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0a0a0a;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#18181b;border:1px solid #27272a;border-radius:12px;">
            <tr>
              <td style="padding:28px 32px;">
                <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px;">Storyseam</div>
                <div style="font-size:13px;color:#71717a;margin-bottom:24px;">Collaborative video studio</div>
                ${htmlBody}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
                  <tr>
                    <td align="center" style="border-radius:8px;background:#10b981;">
                      <a href="${esc(actionUrl)}" style="display:inline-block;padding:12px 28px;color:#052e1b;font-size:15px;font-weight:600;text-decoration:none;">${esc(actionLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="font-size:12px;color:#52525b;line-height:1.6;margin-top:24px;">You're invited to the <strong style="color:#71717a;">${safeOrg}</strong> workspace on Storyseam. If you didn't expect this invitation, you can ignore this email — nothing will change until you accept.</p>
              </td>
            </tr>
          </table>
          <p style="font-size:11px;color:#3f3f46;margin-top:16px;">Storyseam · storyseam.app</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { text, html };
}

// Send an org invitation to `email`. `inviteUrl` is the accept link minted by
// the route; `orgName` is the workspace they're being invited into.
export async function sendInviteEmail(env, { email, orgName, inviteUrl }) {
  if (!env?.EMAIL) return { sent: false, reason: "EMAIL binding not configured" };
  const { text, html } = enclosure({
    orgName,
    actionUrl: inviteUrl,
    actionLabel: "Accept invitation",
    textBody: `${orgName} on Storyseam has invited you to collaborate. Click the link below to accept your invitation and sign in to the workspace.`,
    htmlBody: `<p style="font-size:15px;line-height:1.7;color:#d4d4d8;margin:0 0 4px;">You've been invited to join <strong style="color:#fff;">${esc(orgName || "a team")}</strong> on Storyseam.</p><p style="font-size:14px;line-height:1.7;color:#a1a1aa;margin:0 0 8px;">Accept your invitation to start collaborating on the team's video projects.</p>`,
  });
  try {
    const res = await env.EMAIL.send({
      to: String(email).trim(),
      from: FROM,
      subject: `You're invited to ${orgName} on Storyseam`,
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