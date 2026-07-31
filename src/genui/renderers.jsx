/**
 * The WEB renderer set for the Studio generative-UI contract — shadcn/ui +
 * Tailwind. One export per component in `StudioRenderers` (contract.ts);
 * `mobile-app/src/genui/renderers.tsx` implements the same names and the same
 * props in React Native, so a `render_ui` call draws the same decision on both.
 *
 * Every renderer receives `{ props, renderNode }`. `renderNode` evaluates a
 * child element the parser handed us (an `Option`, a `MediaItem`, …) into a
 * React node — that's how a parent renders its typed children.
 *
 * Interaction is one-way and dead simple: an actionable component calls
 * `useSend(send)`, which posts `send` as the user's next chat message via
 * `useTriggerAction`. See the contract header for why there are no
 * ActionExpressions here.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Expand, Pause, Play } from "lucide-react";
import { useTriggerAction, useIsStreaming } from "@openuidev/react-lang";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useAnswerState } from "./answered";

// The tap handler for anything carrying a `send`. Returns undefined when there
// is nothing to send, so callers can render a non-interactive element instead
// of a dead button.
function useSend(send) {
  const triggerAction = useTriggerAction();
  const streaming = useIsStreaming();
  if (!send || streaming) return undefined;
  return () => triggerAction(send);
}

/**
 * Multi-select plumbing, shared by OptionList and MediaGrid.
 *
 * A list in `select: "many"` mode owns the selection and its children only
 * toggle into it — so `Option` / `MediaItem` render a checkbox instead of
 * firing immediately. The composed message is the list's `send` plus the picked
 * children's `send` values, joined; see the contract's SELECT note for why a
 * multi-select item's `send` is a noun phrase.
 *
 * `null` context = single-select, the default: children send on tap.
 */
const SelectionContext = createContext(null);

function useSelection() {
  return useContext(SelectionContext);
}

/**
 * State + the confirm button for a `select: "many"` list. Returns the provider
 * to wrap the children in and the footer to render under them; in "one" mode
 * both are pass-throughs, so callers have a single code path.
 */
function useMultiSelect({ select, send, confirm }) {
  const [picked, setPicked] = useState(() => new Set());
  const trigger = useSend(send || " ");
  const many = select === "many";

  const value = useMemo(
    () =>
      many
        ? {
            has: (key) => picked.has(key),
            toggle: (key) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              }),
          }
        : null,
    [many, picked],
  );

  const Provider = ({ children }) =>
    many ? (
      <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
    ) : (
      children
    );

  const submit = useSend(
    // The message is only well-formed once something is picked, so an empty
    // selection yields no handler and the button stays disabled.
    many && picked.size && send ? `${send}: ${[...picked].join(", ")}` : null,
  );

  const Footer = () =>
    many ? (
      <Button
        type="button"
        size="sm"
        className="mt-2 w-full"
        disabled={!submit || !trigger}
        onClick={submit}
      >
        {confirm || "Continue"}
        {picked.size ? ` (${picked.size})` : ""}
      </Button>
    ) : null;

  return { Provider, Footer };
}

/** A full-size look at a thumbnail — the web stand-in for the native lightbox. */
function Lightbox({ src, alt, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-2" showCloseButton>
        <DialogTitle className="sr-only">{alt || "Image preview"}</DialogTitle>
        <img src={src} alt={alt || ""} className="max-h-[80vh] w-full rounded-md object-contain" />
      </DialogContent>
    </Dialog>
  );
}

// A small uppercase label above a grouped block — the same eyebrow the rest of
// the app uses over inset cards.
function Header({ children }) {
  if (!children) return null;
  return (
    <p className="px-0.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

// The inset card shell: rounded, bordered, hairline-separated rows inside. The
// web echo of the mobile model-picker card.
function InsetCard({ className, children }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

export function Card({ props, renderNode }) {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border bg-background/40 p-3">
      {children.map((child, i) => (
        <div key={i}>{renderNode(child)}</div>
      ))}
    </div>
  );
}

export function Section({ props, renderNode }) {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">{props.title}</h3>
        {props.subtitle ? (
          <p className="text-xs text-muted-foreground">{props.subtitle}</p>
        ) : null}
      </div>
      <Separator />
      {children.map((child, i) => (
        <div key={i}>{renderNode(child)}</div>
      ))}
    </section>
  );
}

const TEXT_STYLES = {
  body: "text-sm text-foreground",
  muted: "text-xs text-muted-foreground",
  strong: "text-sm font-semibold text-foreground",
  title: "text-sm font-semibold tracking-tight text-foreground",
};

export function Text({ props }) {
  return <p className={TEXT_STYLES[props.style ?? "body"]}>{props.text}</p>;
}

const CALLOUT_STYLES = {
  info: "border-chart-2/30 bg-chart-2/10",
  success: "border-primary/30 bg-primary/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-destructive/40 bg-destructive/10",
};

export function Callout({ props }) {
  return (
    <div className={cn("rounded-lg border p-2.5", CALLOUT_STYLES[props.variant] ?? CALLOUT_STYLES.info)}>
      <p className="text-sm font-medium">{props.title}</p>
      {props.description ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{props.description}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export function Option({ props }) {
  const selection = useSelection();
  const send = useSend(props.send);
  const danger = props.tone === "danger";
  // In a "many" list the row toggles into the parent's selection instead of
  // sending; `checked` then drives the checkbox, while `selected` (the model's
  // "this is already in force" flag) still drives the single-select check mark.
  const checked = selection ? selection.has(props.send) : false;
  const onClick = selection ? (send ? () => selection.toggle(props.send) : undefined) : send;
  // Once the card is answered the row the author took is marked like any other
  // current selection, and the rows they passed over recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      aria-pressed={selection ? checked : marked || undefined}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
        "hover:bg-accent/60 disabled:pointer-events-none",
        picked && "bg-primary/10",
        dimmed ? "opacity-45" : "disabled:opacity-60",
      )}
    >
      {selection ? (
        <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none shrink-0" />
      ) : null}
      {props.image ? (
        <img
          src={props.image}
          alt=""
          className="size-10 shrink-0 rounded-md border object-cover"
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm font-medium",
              danger ? "text-destructive" : "text-foreground",
            )}
          >
            {props.title}
          </span>
          {props.badge ? (
            <Badge variant={marked ? "success" : "muted"} className="shrink-0">
              {props.badge}
            </Badge>
          ) : null}
        </span>
        {props.subtitle ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {props.subtitle}
          </span>
        ) : null}
      </span>
      {props.meta ? (
        <span className="shrink-0 text-xs text-muted-foreground">{props.meta}</span>
      ) : null}
      {/* A multi-select row's affordance is its checkbox — no chevron, or the
          row would advertise a navigation it doesn't do. A passed-over row on an
          answered card gets neither: there is nothing left to navigate to. */}
      {selection ? null : marked ? (
        <Check size={15} className="shrink-0 text-primary" />
      ) : dimmed ? null : (
        <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

export function OptionList({ props, renderNode }) {
  const options = Array.isArray(props.options) ? props.options : [];
  const { Provider, Footer } = useMultiSelect(props);
  return (
    <div>
      <Header>{props.header}</Header>
      <Provider>
        <InsetCard>
          {options.map((opt, i) => (
            <div key={i}>
              {i > 0 ? <Separator className="ml-3 w-auto" /> : null}
              {renderNode(opt)}
            </div>
          ))}
        </InsetCard>
        <Footer />
      </Provider>
      {props.footnote ? (
        <p className="px-0.5 pt-1.5 text-xs text-muted-foreground">{props.footnote}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * A pickable thumbnail. The two gestures are deliberately separate: TAPPING THE
 * IMAGE opens it full-size (you should be able to actually look at a reference
 * before committing to it), while picking is the explicit control underneath —
 * a "Use this" button in a single-select grid, a checkbox in a multi-select one.
 */
export function MediaItem({ props }) {
  const selection = useSelection();
  const [preview, setPreview] = useState(false);
  const send = useSend(props.send);
  const checked = selection ? selection.has(props.send) : false;
  const pick = selection ? (send ? () => selection.toggle(props.send) : undefined) : send;
  // The tile the author picked keeps its ring once the card is answered; the
  // ones they passed over recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;

  return (
    <div className={cn("flex flex-col gap-1.5", dimmed && "opacity-45")}>
      <button
        type="button"
        onClick={() => setPreview(true)}
        aria-label={props.label ? `Preview ${props.label}` : "Preview image"}
        className={cn(
          "group relative block overflow-hidden rounded-lg border-2 transition-colors",
          marked || checked ? "border-primary" : "border-transparent hover:border-border",
        )}
      >
        <img
          src={props.src}
          alt={props.label || ""}
          className="aspect-square w-full bg-muted object-cover"
        />
        <span className="absolute right-1 top-1 rounded-md bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Expand size={11} />
        </span>
        {marked && !selection ? (
          <span className="absolute left-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
            <Check size={11} />
          </span>
        ) : null}
      </button>
      {props.label ? (
        <span className="truncate px-0.5 text-xs font-medium">{props.label}</span>
      ) : null}
      {props.caption ? (
        <span className="line-clamp-2 px-0.5 text-[11px] leading-snug text-muted-foreground">
          {props.caption}
        </span>
      ) : null}
      {selection ? (
        <button
          type="button"
          disabled={!pick}
          onClick={pick}
          className="flex items-center gap-1.5 px-0.5 py-0.5 text-left disabled:pointer-events-none disabled:opacity-60"
        >
          <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
          <span className="text-xs text-muted-foreground">
            {checked ? "Picked" : "Pick"}
          </span>
        </button>
      ) : (
        <Button type="button" size="xs" variant="outline" disabled={!pick} onClick={pick}>
          Use this
        </Button>
      )}
      <Lightbox
        src={props.src}
        alt={props.label}
        open={preview}
        onOpenChange={setPreview}
      />
    </div>
  );
}

export function MediaGrid({ props, renderNode }) {
  const items = Array.isArray(props.items) ? props.items : [];
  const columns = props.columns === 3 ? 3 : 2;
  const { Provider, Footer } = useMultiSelect(props);
  return (
    <div>
      <Header>{props.header}</Header>
      <Provider>
        <div className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {items.map((item, i) => (
            <div key={i}>{renderNode(item)}</div>
          ))}
        </div>
        <Footer />
      </Provider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

// The one clip playing anywhere in the chat — starting a row pauses whichever
// other row was playing, like the Sounds tab's one-player-at-a-time rule.
let activeClip = null;

/**
 * A lazily created HTMLAudioElement behind a play/pause toggle. The element is
 * only constructed on the first tap, so a card full of takes doesn't open a
 * connection per row on mount.
 */
function useAudioClip(src) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(
    () => () => {
      const el = ref.current;
      if (!el) return;
      el.pause();
      if (activeClip === el) activeClip = null;
    },
    [],
  );

  const toggle = () => {
    let el = ref.current;
    if (!el) {
      el = new Audio(src);
      el.preload = "auto";
      el.addEventListener("timeupdate", () => {
        if (el.duration) setProgress(el.currentTime / el.duration);
      });
      el.addEventListener("durationchange", () => {
        if (Number.isFinite(el.duration)) setDuration(el.duration);
      });
      el.addEventListener("play", () => {
        if (activeClip && activeClip !== el) activeClip.pause();
        activeClip = el;
        setPlaying(true);
      });
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("ended", () => {
        el.currentTime = 0;
        setProgress(0);
      });
      ref.current = el;
    }
    if (el.paused) el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return { playing, progress, duration, toggle };
}

function formatSeconds(s) {
  if (!Number.isFinite(s) || s <= 0) return null;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * One playable clip. The two gestures mirror MediaItem's: TAPPING THE ROW
 * plays/pauses (you should be able to actually hear a take before committing
 * to it), while picking is the explicit control at the trailing edge — and only
 * rows given a `send` have one, so a listen-only card is just rows.
 */
export function AudioItem({ props }) {
  const selection = useSelection();
  const send = useSend(props.send);
  const { playing, progress, duration, toggle } = useAudioClip(props.src);
  const checked = selection && props.send ? selection.has(props.send) : false;
  const pick = selection ? (send ? () => selection.toggle(props.send) : undefined) : send;
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;
  const time = formatSeconds(duration);

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3",
        picked && "bg-primary/10",
        dimmed && "opacity-45",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "Pause" : "Play"} ${props.title}`}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors",
          playing
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-card hover:bg-accent/60",
        )}
      >
        {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
      </button>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{props.title}</span>
          {props.badge ? (
            <Badge variant={marked ? "success" : "muted"} className="shrink-0">
              {props.badge}
            </Badge>
          ) : null}
        </span>
        {props.subtitle ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {props.subtitle}
          </span>
        ) : null}
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{time || props.meta}</span>
      {selection && props.send ? (
        <button
          type="button"
          disabled={!pick}
          onClick={pick}
          aria-label={`${checked ? "Unpick" : "Pick"} ${props.title}`}
          className="shrink-0 disabled:pointer-events-none disabled:opacity-60"
        >
          <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
        </button>
      ) : props.send ? (
        marked ? (
          <Check size={15} className="shrink-0 text-primary" />
        ) : (
          <Button type="button" size="xs" variant="outline" disabled={!pick} onClick={pick}>
            Use this
          </Button>
        )
      ) : null}
    </div>
  );
}

export function AudioList({ props, renderNode }) {
  const items = Array.isArray(props.items) ? props.items : [];
  const { Provider, Footer } = useMultiSelect(props);
  return (
    <div>
      <Header>{props.header}</Header>
      <Provider>
        <InsetCard>
          {items.map((item, i) => (
            <div key={i}>
              {i > 0 ? <Separator className="ml-3 w-auto" /> : null}
              {renderNode(item)}
            </div>
          ))}
        </InsetCard>
        <Footer />
      </Provider>
      {props.footnote ? (
        <p className="px-0.5 pt-1.5 text-xs text-muted-foreground">{props.footnote}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export function Recommendation({ props }) {
  const onClick = useSend(props.send);
  const [preview, setPreview] = useState(false);
  const bullets = Array.isArray(props.bullets) ? props.bullets : [];
  return (
    <InsetCard>
      {props.image ? (
        <button
          type="button"
          onClick={() => setPreview(true)}
          aria-label={`Preview ${props.title}`}
          className="block w-full"
        >
          <img src={props.image} alt="" className="h-32 w-full bg-muted object-cover" />
          <Lightbox
            src={props.image}
            alt={props.title}
            open={preview}
            onOpenChange={setPreview}
          />
        </button>
      ) : null}
      <div className="flex flex-col gap-2.5 p-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h4 className="min-w-0 flex-1 text-sm font-semibold">{props.title}</h4>
            {props.badge ? <Badge variant="success">{props.badge}</Badge> : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.body}</p>
        </div>
        {bullets.length ? (
          <ul className="flex flex-col gap-1">
            {bullets.slice(0, 4).map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Check size={12} className="mt-0.5 shrink-0 text-primary" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {props.meta ? (
          <p className="text-[11px] text-muted-foreground">{props.meta}</p>
        ) : null}
        <Button type="button" disabled={!onClick} onClick={onClick} className="w-full">
          {props.cta || "Continue"}
        </Button>
      </div>
    </InsetCard>
  );
}

// ---------------------------------------------------------------------------
// Comparison & detail
// ---------------------------------------------------------------------------

export function Column({ props }) {
  const onClick = useSend(props.send);
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button", onClick } : {})}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-left",
        onClick && "transition-colors hover:bg-accent/60",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{props.label}</span>
        {props.badge ? (
          <Badge variant="success" className="shrink-0 text-[10px]">
            {props.badge}
          </Badge>
        ) : null}
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.label}
          </span>
          <span className="text-xs">{row.value}</span>
        </div>
      ))}
    </Wrapper>
  );
}

export function Compare({ props, renderNode }) {
  const columns = Array.isArray(props.columns) ? props.columns.slice(0, 3) : [];
  return (
    <div>
      <Header>{props.header}</Header>
      <div className="flex gap-2">
        {columns.map((col, i) => (
          <div key={i} className="flex min-w-0 flex-1">
            {renderNode(col)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function KeyValue({ props }) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  return (
    <div>
      <Header>{props.header}</Header>
      <InsetCard>
        {rows.map((row, i) => (
          <div key={i}>
            {i > 0 ? <Separator className="ml-3 w-auto" /> : null}
            <div className="flex items-baseline gap-3 px-3 py-2">
              <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
              <span className="min-w-0 flex-1 text-right text-xs font-medium break-words">
                {row.value}
              </span>
            </div>
          </div>
        ))}
      </InsetCard>
    </div>
  );
}

export function Steps({ props }) {
  const steps = Array.isArray(props.steps) ? props.steps : [];
  const current = typeof props.current === "number" ? props.current : -1;
  return (
    <div>
      <Header>{props.header}</Header>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, i) => {
          const done = current > i;
          const active = current === i;
          return (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "border-2 border-primary text-primary"
                      : "border text-muted-foreground",
                )}
              >
                {done ? <Check size={11} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-sm",
                      active ? "font-semibold" : "font-medium",
                      done && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  {step.meta ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{step.meta}</span>
                  ) : null}
                </span>
                {step.detail ? (
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {step.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function Chip({ label }) {
  const onClick = useSend(label);
  return (
    <Button type="button" size="sm" variant="outline" disabled={!onClick} onClick={onClick}>
      {label}
    </Button>
  );
}

export function Chips({ props }) {
  const labels = Array.isArray(props.labels) ? props.labels : [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label, i) => (
        <Chip key={i} label={label} />
      ))}
    </div>
  );
}

export function Action({ props }) {
  const onClick = useSend(props.send);
  // The button the author pressed reads as pressed once the card is answered —
  // it goes solid, and the ones they didn't press recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const variant =
    props.tone === "danger"
      ? "destructive"
      : props.variant === "primary" || picked
        ? "default"
        : "secondary";
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        "h-auto max-w-full min-w-0 justify-start py-1.5 text-left leading-snug whitespace-normal",
        dimmed && "opacity-45",
      )}
    >
      {picked ? <Check size={14} className="shrink-0" /> : null}
      {props.label}
    </Button>
  );
}

export function Actions({ props, renderNode }) {
  const actions = Array.isArray(props.actions) ? props.actions : [];
  return (
    <div
      className={cn(
        "flex gap-1.5",
        props.direction === "column" ? "flex-col items-stretch" : "flex-wrap",
      )}
    >
      {actions.map((action, i) => (
        <div key={i} className={props.direction === "column" ? "flex" : undefined}>
          {renderNode(action)}
        </div>
      ))}
    </div>
  );
}

/** The web design system, in the shape `buildStudioLibrary()` expects. */
export const webRenderers = {
  Card,
  Section,
  Text,
  Callout,
  Option,
  OptionList,
  MediaItem,
  MediaGrid,
  AudioItem,
  AudioList,
  Recommendation,
  Column,
  Compare,
  KeyValue,
  Steps,
  Chips,
  Action,
  Actions,
};
