// `/` — the open-source Storyseam front page: what a storyseam.md is, the
// folder it sits at the root of, and the two doors out — the spec (/spec) and
// the hosted Studio (/studio, HOME_PATH). Anything `/` is sent WITH a query
// never renders here: router.jsx forwards it to the Studio, which owns every
// `?resume`, `?billing` and `?mode` that used to land on the root.
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Label } from "@/components/HudHeader";
import { AGENT_ONE_LINER, CodeBlock, INSTALL, Mono, Plate, SpecPage } from "@/components/SpecSite";
import { DISPLAY, DISPLAY_TRACKING } from "@/lib/hudTheme";
import { HOME_PATH } from "@/lib/home";
import { useEffect } from "react";

const EXAMPLE = `---
storyseam: 0.1
title: Nothing To Do
logline: >-
  Milo comes over to play. For one long second, neither boy can
  think of a single thing to do — and then Theo looks at the blanket.
look: Pixar-style 3D animation, warm late-afternoon light
arc: kishotenketsu
language: en
---
# Nothing To Do

## Premise
A kid arrives at his friend's house to play. The room is full of
toys and empty of ideas. Then one of them has an idea.

## Decisions
- **One physical location** for all four blocks. The point is that
  the *same* room becomes extraordinary.

## Status
- [x] scaffolded
- [x] script
- [ ] shot list`;

const TREE = `my-film/
  storyseam.md          what it is, why, and where it stands
  config.json           models, resolution, aspect, providers, costs
  CLAUDE.md / AGENTS.md how an agent works in THIS folder
  script/               outline.md, script.md, drafts/, reviews.json
  world/                characters.md, locations.md, props.md
  prompts/              the two style prompts, appended to every call
  shotlist/             shotlist.json, the seam /cast and /render read
  assets/               character sheets, plates, voices
  renders/              clips/, frames/ (the continuity chain), final/
  .storyseam/           state.json, media.json`;

const STAGES = [
  ["/start-story", "storyseam.md"],
  ["/write-script", "script"],
  ["/shotlist", "30s blocks"],
  ["/cast", "assets"],
  ["/render", "clips"],
  ["/assemble", "film.mp4"],
];

export function Component() {
  useEffect(() => {
    document.title = "Storyseam: a film, described to agents";
  }, []);
  return (
    <SpecPage>
      <section className="py-14 sm:py-20">
        <Label>Open source · storyseam.md</Label>
        <h1
          className="mt-4 mb-6 text-[2.6rem] leading-[1.02] sm:text-[4rem]"
          style={{ fontFamily: DISPLAY, fontWeight: 700, letterSpacing: DISPLAY_TRACKING }}
        >
          A film, described to agents.
        </h1>
        <p className="max-w-[62ch] text-base text-[var(--br-secondary)]">
          Storyseam is a folder convention for making a film with a coding agent. At its root is{" "}
          <Mono>storyseam.md</Mono>: tokens a machine can read in its front matter, and the reasons
          behind them in prose. It's the way <Mono>design.md</Mono> describes a design system. Any
          agent that opens the folder knows what the story is, what has been decided, and what
          comes next.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Door
            to="/spec"
            label="The spec"
            title="storyseam.md"
            body="The format, the agent prompt that sets a project up, and one URL for every skill."
          />
          <Door
            to={HOME_PATH}
            label="The Studio"
            title="StorySeam Studio"
            body="The hosted app. Type a prompt and get a finished film back, then keep working on it in the studio."
          />
        </div>
      </section>

      <Plate fig="Fig. 01" title="One file at the root">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <CodeBlock code={EXAMPLE} label="storyseam.md" />
          <div className="space-y-4 text-[var(--br-secondary)]">
            <p>
              <span className="text-foreground">Tokens without rationale</span> produce a film that is
              internally consistent and lifeless. <span className="text-foreground">Rationale without tokens</span>{" "}
              produces one that cannot be rendered twice the same way. <Mono>storyseam.md</Mono> keeps
              both in one known place.
            </p>
            <p>
              It never copies a value another file owns. Render settings live in{" "}
              <Mono>config.json</Mono>, names live in <Mono>world/</Mono>, and the script lives in{" "}
              <Mono>script/script.md</Mono>. When a value appears in two places, the owning file wins
              and the copy is a bug.
            </p>
            <Link to="/spec#spec" className="inline-flex items-center gap-1.5 text-foreground underline-offset-4 hover:underline">
              Read the specification <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </Plate>

      <Plate fig="Fig. 02" title="The tree is the state">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <CodeBlock code={TREE} label="a story folder" />
          <div className="space-y-4 text-[var(--br-secondary)]">
            <p>
              There is no database, no server and no app. A story is a folder, so it is portable and
              diffable, and any agent can pick it up mid-flight.
            </p>
            <p>
              Absence is meaningful. A script but no shot list means <Mono>/shotlist</Mono> is next.
              Clips but no <Mono>renders/final/</Mono> means <Mono>/assemble</Mono>. Nothing
              downstream needs configuring, because everything knows where to look.
            </p>
          </div>
        </div>
      </Plate>

      <Plate fig="Fig. 03" title="The pipeline">
        <ol className="grid grid-cols-2 gap-px border border-[var(--br-secondary)]/25 bg-[var(--br-secondary)]/25 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map(([cmd, what]) => (
            <li key={cmd} className="flex flex-col gap-1 bg-[var(--br-surface)] p-4">
              <Mono>{cmd}</Mono>
              <Label>{what}</Label>
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-[68ch] text-sm text-[var(--br-secondary)]">
          Each command loads one skill. A room of 21 script specialists reads the draft in stage
          order. Blocks render one at a time, and the last frame of block N becomes the first
          reference of block N+1.
        </p>
      </Plate>

      <Plate fig="Fig. 04" title="Hand it to your agent">
        <p className="mb-5 max-w-[68ch] text-[var(--br-secondary)]">
          Paste this into Claude Code, Codex or Cursor. The prompt it points at explains how to lay
          the project out and where to get every skill.
        </p>
        <CodeBlock code={AGENT_ONE_LINER} accent wrap />
        <p className="mt-6 mb-3 text-sm text-[var(--br-secondary)]">Or install it yourself:</p>
        <CodeBlock code={INSTALL} />
      </Plate>
    </SpecPage>
  );
}

function Door({ to, label, title, body }) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 border border-[var(--br-secondary)]/30 bg-[var(--br-surface)] p-5 transition-colors hover:border-foreground/50"
    >
      <Label>{label}</Label>
      <span className="flex items-center gap-2 text-lg" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
        {title} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
      <span className="text-sm text-[var(--br-secondary)]">{body}</span>
    </Link>
  );
}
