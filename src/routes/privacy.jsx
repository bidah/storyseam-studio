// Public privacy policy (/privacy). Sibling of RootLayout — see LegalPage.jsx
// for why it must render without a session.
//
// EVERY factual claim here was checked against the code, and it has to STAY
// that way — a privacy policy that drifts from the implementation is worse than
// none. The load-bearing ones, with where to re-check them:
//   • Google scopes are `email profile openid`   → worker/src/auth.js
//   • Account/session/token columns              → worker/schema.sql ("user",
//     "session", "account")
//   • Docs + attributed version history          → worker/src/lib/docs.js,
//     lib/history.js; D1 Time Travel is 30 days (CLAUDE.md)
//   • BYOK keys stay in localStorage only        → src/lib/falKey.js,
//     src/lib/atlasKey.js — they ride as a per-request header, never stored
//   • Voice notes go to Workers AI Whisper       → worker/src/routes/transcribe.js
//   • NO analytics/tracking of any kind          → verified by grep; if that
//     ever changes, this page changes first
//
// NOT legal advice and not lawyer-reviewed — drafted to describe the system
// accurately. Have counsel review before relying on it.
import { LegalPage, Section, List } from "@/components/LegalPage";

export function Component() {
  return (
    <LegalPage title="Privacy Policy" updated="5 August 2026">
      <Section title="Who we are">
        <p>
          StorySeam (<span className="text-foreground">storyseam.app</span>) is a workspace for
          writing, storyboarding, rendering and cutting short animated episodes. It is operated
          by Rodrigo Figueroa as an individual.
        </p>
        <p>
          For any question about this policy or your data, write to{" "}
          <a
            href="mailto:privacy@storyseam.app"
            className="text-foreground underline underline-offset-4"
          >
            privacy@storyseam.app
          </a>
          .
        </p>
      </Section>

      <Section title="What we collect">
        <List>
          <li>
            <span className="text-foreground">Account details.</span> When you sign in with
            Google we receive your name, email address, profile picture and Google account
            identifier. Those are the only scopes we request. We never gain access to your
            Gmail, Drive, contacts or any other Google data, and we never post on your behalf.
          </li>
          <li>
            <span className="text-foreground">Session details.</span> A session token, its
            expiry, and the IP address and browser user-agent that created it — used to keep
            you signed in and to spot abuse.
          </li>
          <li>
            <span className="text-foreground">Connected rendering accounts.</span> If you link
            a Higgsfield account, we store the access token it issues so generations can run on
            your behalf. You can disconnect it at any time in Settings.
          </li>
          <li>
            <span className="text-foreground">The work you create.</span> Scripts, world and
            character notes, shot lists, prompts, timelines, cuts, and your conversations with
            the in-app agent. Documents are versioned: we keep previous revisions along with
            which account changed them, so you can restore earlier drafts.
          </li>
          <li>
            <span className="text-foreground">Media.</span> Images, audio and video you upload
            or generate, plus files you attach to a chat.
          </li>
          <li>
            <span className="text-foreground">Voice messages.</span> If you record one in the
            chat composer, the audio is sent to Cloudflare's speech-to-text model to be
            transcribed into text.
          </li>
          <li>
            <span className="text-foreground">Which screen you are on.</span> The app reports
            your current tab and selection so the agent can answer questions like "make this
            shot wider". This is stored per user and is only identifiers and short labels.
          </li>
        </List>
      </Section>

      <Section title="What we deliberately do not do">
        <List>
          <li>
            <span className="text-foreground">No analytics or tracking.</span> There is no
            analytics service, no tracking pixel, no advertising network and no third-party
            script of any kind on this site.
          </li>
          <li>
            <span className="text-foreground">No advertising cookies.</span> The only cookie we
            set is the one that keeps you signed in.
          </li>
          <li>
            <span className="text-foreground">
              Your fal.ai and Atlas Cloud API keys never reach our servers.
            </span>{" "}
            They are held in your own browser's local storage and attached directly to the
            requests that need them. We do not store, log or retain them.
          </li>
          <li>
            <span className="text-foreground">We do not sell or share your data</span> with
            anyone for advertising or marketing, and we do not use your work to train AI models.
          </li>
        </List>
      </Section>

      <Section title="Why we process it">
        <p>
          To run the service you asked for: to sign you in, keep your projects separate from
          other people's, store and version your work, generate the media you request, and
          protect the service against abuse. We do not process your content for any purpose you
          have not asked for.
        </p>
      </Section>

      <Section title="Who else processes it">
        <p>
          We keep this list short on purpose. Each of these acts as a processor for a specific
          part of the service:
        </p>
        <List>
          <li>
            <span className="text-foreground">Cloudflare</span> — hosting, database, media
            storage, live sync and speech-to-text. Effectively all data lives here.
          </li>
          <li>
            <span className="text-foreground">Google</span> — sign-in only.
          </li>
          <li>
            <span className="text-foreground">Higgsfield, fal.ai, Atlas Cloud</span> — image,
            video and audio generation, and only when you have connected one and asked for a
            generation. Your prompts and any reference media you supply are sent to the
            provider you chose.
          </li>
          <li>
            <span className="text-foreground">Anthropic, Cerebras, OpenAI, DeepSeek and OpenRouter</span> — the
            language models behind the in-app agent, reached through Cloudflare's AI gateway.
            Your messages to the agent, and the project context it needs to answer, are sent to
            whichever model you have selected.
          </li>
          <li>
            <span className="text-foreground">Daytona</span> — temporary sandboxes that
            assemble and encode video for renders and exports.
          </li>
        </List>
        <p>
          These providers handle your data under their own terms. If you never connect a
          rendering account and never use the agent, none of the last three groups receive
          anything.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Your projects and media are kept until you delete them or ask us to close your
          account. Because documents are versioned, deleting text from a document does not
          immediately erase its earlier revisions — those remain in the document's history so
          you can restore them. The database also keeps a rolling 30-day point-in-time backup,
          so recently deleted data may persist in backups for up to 30 days before ageing out.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask us for a copy of your data, ask us to correct it, or ask us to delete
          your account and everything in it. Write to{" "}
          <a
            href="mailto:privacy@storyseam.app"
            className="text-foreground underline underline-offset-4"
          >
            privacy@storyseam.app
          </a>{" "}
          and we will action it within 30 days. Depending on where you live you may also have
          the right to object to processing, to request portability, or to complain to your
          local data protection authority.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Traffic is encrypted in transit. Every request that touches project data must carry a
          valid identity, and requests are checked against the project's owner — an account
          cannot read or modify another account's projects. No system is perfectly secure, but
          if we ever discover a breach affecting your data we will tell you.
        </p>
      </Section>

      <Section title="Children">
        <p>
          StorySeam is not intended for children under 13, and we do not knowingly collect data
          from them. If you believe a child has given us personal data, write to us and we will
          delete it.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes we will update the date at the top of this page. Material
          changes will be announced in the app before they take effect.
        </p>
      </Section>
    </LegalPage>
  );
}
