// `/spec` — the storyseam.md specification, the agent prompt that sets a
// project up in it, and the one URL every skill is reachable from.
//
// The words are NOT written here. They are the storyseam repo's own files,
// vendored into public/spec/ by `npm run spec:sync` and served as static
// assets beside this page (/spec/storyseam.md, /spec/agent.md,
// /spec/skills.json), so the page, the raw files an agent fetches, and the
// repo can never disagree.
import { useEffect } from "react";
import { useLoaderData } from "react-router";
import { ExternalLink } from "lucide-react";
import { Streamdown } from "streamdown";
import { Label } from "@/components/HudHeader";
import {
  AGENT_ONE_LINER,
  AGENT_URL,
  CodeBlock,
  INSTALL,
  Mono,
  Plate,
  SKILLS_URL,
  SPEC_URL,
  SpecPage,
  TARBALL_URL,
} from "@/components/SpecSite";
import { DISPLAY, DISPLAY_TRACKING } from "@/lib/hudTheme";

async function text(path) {
  const res = await fetch(path);
  const type = res.headers.get("content-type") || "";
  // A missing file falls through to the SPA's index.html: never render that as markdown.
  if (!res.ok || type.includes("text/html")) return "";
  return res.text();
}

export async function loader() {
  const [spec, agent, manifest] = await Promise.all([
    text("/spec/storyseam.md"),
    text("/spec/agent.md"),
    text("/spec/skills.json").then((s) => {
      try {
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    }),
  ]);
  return { spec, agent, manifest };
}

// The spec's own front matter is metadata for tools, not prose for the page.
const stripFrontMatter = (md) => md.replace(/^---\n[\s\S]*?\n---\n/, "");
const versionOf = (md) => /^version:\s*(.+)$/m.exec(md)?.[1]?.trim();

const PROSE =
  "max-w-none space-y-4 leading-relaxed text-[var(--br-primary)] " +
  "[&_h1]:hidden [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:font-semibold " +
  "[&_p]:text-[var(--br-secondary)] [&_li]:text-[var(--br-secondary)] [&_strong]:text-[var(--br-primary)] " +
  "[&_a]:underline [&_a]:underline-offset-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_code]:font-mono [&_code]:text-[0.86em] [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[var(--br-secondary)]/30 " +
  "[&_pre]:bg-[var(--br-surface)] [&_pre]:p-4 [&_table]:w-full [&_table]:text-sm [&_th]:text-left " +
  "[&_td]:border-b [&_td]:border-[var(--br-secondary)]/20 [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-4";

// Plain code: Streamdown's own blocks wait on a highlighter plugin this app
// doesn't load (the chat never needed one), and render empty without it.
const MD_COMPONENTS = {
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ className, children }) => <code className={className}>{children}</code>,
};

const KINDS = [
  ["skill", "Pipeline skills"],
  ["registry", "Model directors & provider adapters"],
  ["specialist", "Script specialists"],
  ["command", "Slash commands"],
  ["schema", "Schemas"],
  ["doc", "Docs & decision records"],
];

export function Component() {
  const { spec, agent, manifest } = useLoaderData();
  const version = versionOf(spec);
  useEffect(() => {
    document.title = "storyseam.md: the Storyseam spec";
  }, []);
  const files = manifest?.files || [];

  return (
    <SpecPage>
      <section className="py-14 sm:py-16">
        <Label>Specification{version ? ` · v${version}` : ""} · alpha</Label>
        <h1
          className="mt-4 mb-6 text-[2.6rem] leading-[1.02] sm:text-[4rem]"
          style={{ fontFamily: DISPLAY, fontWeight: 700, letterSpacing: DISPLAY_TRACKING }}
        >
          storyseam.md
        </h1>
        <p className="max-w-[62ch] text-base text-[var(--br-secondary)]">
          One Markdown file at the root of a story folder. YAML front matter holds the tokens, and
          the prose sections hold the decisions and the reasons for them. Below are the agent prompt
          that sets a project up in this structure, the URL every skill is served from, and the full
          specification.
        </p>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Raw href={SPEC_URL}>storyseam.md</Raw>
          <Raw href={AGENT_URL}>agent.md</Raw>
          <Raw href={SKILLS_URL}>skills.json</Raw>
          <Raw href="/spec/template.md">template.md</Raw>
          <Raw href="/spec/example.md">example.md</Raw>
        </div>
      </section>

      <Plate fig="01" title="The agent prompt" id="agent">
        <p className="mb-5 max-w-[68ch] text-[var(--br-secondary)]">
          Give your agent this one line. It fetches the prompt, installs the engine, interviews you
          for the five things a story needs, writes <Mono>storyseam.md</Mono>, and stops before
          spending anything.
        </p>
        <CodeBlock code={AGENT_ONE_LINER} accent wrap />
        {agent ? (
          <details className="mt-6 border border-[var(--br-secondary)]/30 bg-[var(--br-surface)]">
            <summary className="cursor-pointer px-4 py-3">
              <Label>The full prompt · agent.md</Label>
            </summary>
            <div className="border-t border-[var(--br-secondary)]/25">
              <CodeBlock code={agent} wrap className="border-0" />
            </div>
          </details>
        ) : null}
      </Plate>

      <Plate fig="02" title="Every skill, one URL" id="skills">
        <p className="mb-5 max-w-[68ch] text-[var(--br-secondary)]">
          The whole engine is one tarball: pipeline skills, specialists, commands, schemas, and the
          per-model directors. <Mono>init</Mono> lays them out for Claude Code, Codex or Cursor and
          rewrites the paths inside them to match.
        </p>
        <CodeBlock code={INSTALL} />
        <p className="mt-4 text-sm text-[var(--br-secondary)]">
          Tarball: <a href={TARBALL_URL} className="text-foreground underline underline-offset-4"><Mono>{TARBALL_URL}</Mono></a>.
          Every file one by one, with the path it belongs at:{" "}
          <a href={SKILLS_URL} className="text-foreground underline underline-offset-4"><Mono>{SKILLS_URL}</Mono></a>.
        </p>
        {files.length ? (
          <div className="mt-6 grid grid-cols-1 gap-px border border-[var(--br-secondary)]/25 bg-[var(--br-secondary)]/25 sm:grid-cols-2">
            {KINDS.map(([kind, title]) => {
              const list = files.filter((f) => f.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind} className="min-w-0 bg-[var(--br-surface)] p-4">
                  <Label>{title} · {list.length}</Label>
                  <ul className="mt-3 space-y-1 text-[0.78rem]">
                    {list.map((f) => (
                      <li key={f.path} className="truncate">
                        <a href={f.url.replace(/^https:\/\/storyseam\.app/, "")} className="hover:underline" title={f.path}>
                          <Mono>{f.path}</Mono>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : null}
      </Plate>

      <Plate fig="03" title="The specification" id="spec">
        {spec ? (
          <Streamdown mode="static" controls={false} components={MD_COMPONENTS} className={PROSE}>
            {stripFrontMatter(spec)}
          </Streamdown>
        ) : (
          <p className="text-[var(--br-secondary)]">
            The specification is at <Raw href={SPEC_URL}>storyseam.md</Raw>.
          </p>
        )}
      </Plate>
    </SpecPage>
  );
}

function Raw({ href, children }) {
  return (
    <a href={href} className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
      <Mono>{children}</Mono>
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}
