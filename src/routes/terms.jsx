// Public terms of service (/terms). Sibling of RootLayout — see LegalPage.jsx
// for why it must render without a session.
//
// TO DO — no governing-law / jurisdiction clause. Deliberately omitted rather
// than guessed at, because naming the wrong forum is worse than naming none.
// Add one when the operating jurisdiction is settled.
//
// NOT legal advice and not lawyer-reviewed — drafted to describe the service
// accurately. Have counsel review before relying on it.
import { LegalPage, Section, List } from "@/components/LegalPage";
import { useT } from "@/lib/i18n";

export function Component() {
  const t = useT();
  return (
    <LegalPage title={t("Terms of Service")} updated="5 August 2026">
      <Section title={t("The short version")}>
        <p>
          {t("StorySeam is a workspace for making short animated episodes. Your work stays yours. Generation runs on rendering accounts you connect yourself, so those costs are yours too. The service is offered as-is, and is still early software. The sections below say all of that more carefully.")}
        </p>
      </Section>

      <Section title={t("Who you are agreeing with")}>
        <p>
          {t("These terms are between you and Rodrigo Figueroa, operating StorySeam as an individual (\"we\", \"us\"). By signing in you accept them. If you do not accept them, do not use the service.")}
        </p>
      </Section>

      <Section title={t("Your account")}>
        <p>
          {t("You sign in with Google, and you need to be old enough to form a binding contract where you live — and at least 13 in any case. You are responsible for what happens under your account, so keep access to your Google account secure. Tell us promptly if you think someone else has got in.")}
        </p>
      </Section>

      <Section title={t("Your content stays yours")}>
        <p>
          {t("You keep all rights to everything you bring to StorySeam or make with it — scripts, notes, shot lists, images, audio, video and cuts. We claim no ownership over any of it.")}
        </p>
        <p>
          {t("To actually run the service we need your permission to store your content, process it, display it back to you, and pass the relevant parts to the providers you have chosen so a generation or render can happen. That permission is limited to operating StorySeam for you, and it ends when you delete the content or your account. We will not publish your work, show it to other users, or use it to train AI models.")}
        </p>
      </Section>

      <Section title={t("Generated content")}>
        <p>
          {t("Images, video and audio are produced by third-party AI models. A few things follow from that, and they are worth understanding before you rely on any output:")}
        </p>
        <List>
          <li>
            {t("The provider's own terms govern what you may do with what their model produces, and those terms sit alongside these.")}
          </li>
          <li>
            {t("Whether AI output can be copyrighted, and by whom, is unsettled and differs by country. We make no promise that you own an output or that it is protectable.")}
          </li>
          <li>
            {t("Models can produce results that resemble existing work. We cannot guarantee any output is original or free of third-party rights — checking that, before you publish or commercialise anything, is your responsibility.")}
          </li>
          <li>
            {t("Output can simply be wrong, unusable, or not what you asked for. Generation consumes credits on your provider account either way.")}
          </li>
        </List>
      </Section>

      <Section title={t("Rendering accounts and costs")}>
        <p>
          {t("StorySeam does not sell credits and does not process payments. You connect your own Higgsfield, fal.ai or Atlas Cloud account, and every generation bills directly to that account under your agreement with that provider. We are not affiliated with any of them, and we are not responsible for their pricing, availability or output.")}
        </p>
      </Section>

      <Section title={t("Acceptable use")}>
        <p>{t("You agree not to use StorySeam to:")}</p>
        <List>
          <li>
            {t("create or distribute anything illegal — in particular any sexual content involving minors, which we report and act on without exception;")}
          </li>
          <li>
            {t("infringe someone else's copyright, trademark, privacy or likeness, including generating a real person's image or voice without their consent;")}
          </li>
          <li>
            {t("create material that harasses, defames or incites violence against anyone, or that is designed to deceive people about who made it or what it depicts;")}
          </li>
          <li>
            {t("attack or abuse the service — probing for vulnerabilities, circumventing access controls, scraping, or overwhelming it with automated traffic;")}
          </li>
          <li>{t("resell or redistribute the service as your own.")}</li>
        </List>
        <p>
          {t("We may suspend or close an account that breaks these rules, and we will try to tell you why when we do.")}
        </p>
      </Section>

      <Section title={t("Availability")}>
        <p>
          {t("StorySeam is early software under active development. Features may change or be removed, and there is no uptime guarantee. Renders and generations depend on third-party providers that can be slow, rate-limited or unavailable. Keep your own copies of anything you cannot afford to lose.")}
        </p>
      </Section>

      <Section title={t("No warranty")}>
        <p>
          {t("The service is provided \"as is\" and \"as available\", without warranties of any kind, whether express or implied, including any implied warranty of merchantability, fitness for a particular purpose or non-infringement. We do not warrant that the service will be uninterrupted, error-free, or that any output will meet your expectations.")}
        </p>
      </Section>

      <Section title={t("Limitation of liability")}>
        <p>
          {t("To the fullest extent the law allows, we are not liable for indirect, incidental, special or consequential damages, nor for lost profits, lost revenue or lost or corrupted data, arising from your use of the service. Nothing here limits liability that cannot lawfully be limited — including for fraud, or for death or personal injury caused by negligence.")}
        </p>
      </Section>

      <Section title={t("Ending it")}>
        <p>
          {t("You can stop using StorySeam whenever you like and ask us to delete your account by writing to ")}
          <a
            href="mailto:privacy@storyseam.app"
            className="text-foreground underline underline-offset-4"
          >
            privacy@storyseam.app
          </a>
          {t(". We may suspend or close an account that breaches these terms, or if we discontinue the service — in which case we will give reasonable notice so you can export your work.")}
        </p>
      </Section>

      <Section title={t("Changes")}>
        <p>
          {t("We may update these terms. The date at the top of this page changes when we do, and material changes will be announced in the app before they take effect. Continuing to use StorySeam after that means you accept the new version.")}
        </p>
      </Section>

      <Section title={t("Contact")}>
        <p>
          {t("Questions about these terms go to ")}
          <a
            href="mailto:privacy@storyseam.app"
            className="text-foreground underline underline-offset-4"
          >
            privacy@storyseam.app
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
