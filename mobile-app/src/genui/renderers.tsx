/**
 * The MOBILE renderer set for the Studio generative-UI contract — React Native
 * + NativeWind. One export per component in `StudioRenderers` (contract.ts),
 * matching `src/genui/renderers.jsx` name for name and prop for prop, so a
 * single `render_ui` call draws the same decision on web and on the phone.
 *
 * The look is the app's own, not a port of the web card:
 *   · OptionList / KeyValue are the inset grouped card from the model picker —
 *     rounded-[28px] bordered card, hairline separators inset from the left.
 *   · Recommendation's call-to-action is the `SemiPillButton` hero slab (the
 *     Discover story's "Try this"), liquid glass on iOS 26.
 *   · Tappable rows and thumbnails ride on `BouncyPressable`, the same press
 *     feel as the rest of the app's cards.
 *
 * Interaction: an actionable component calls `useSend(send)`, which posts
 * `send` as the user's next chat message. See the contract header for why there
 * are no ActionExpressions here.
 */
import type { ReactNode } from 'react';
import { createContext, Fragment, useContext, useMemo, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import { Check, ChevronRight } from 'lucide-react-native';
import { useIsStreaming, useTriggerAction } from '@openuidev/react-lang';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { SemiPillButton } from '@/components/ui/semi-pill-button';
import { useColors } from '@/lib/colors';
import { useEffectiveScheme } from '@/lib/theme';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAnswerState } from './answered';
import type {
  ActionProps,
  ActionsProps,
  CalloutProps,
  CardProps,
  ColumnProps,
  CompareProps,
  KeyValueProps,
  MediaGridProps,
  MediaItemProps,
  OptionListProps,
  OptionProps,
  RecommendationProps,
  SectionProps,
  StepsProps,
  StudioRenderers,
  TextProps,
} from './contract';

type Render<P> = { props: P; renderNode: (value: unknown) => ReactNode };

// The tap handler for anything carrying a `send`. Returns undefined when there
// is nothing to send or the card is inert, so callers render a dead-looking
// element rather than a live one that does nothing.
function useSend(send?: string | null) {
  const triggerAction = useTriggerAction();
  const streaming = useIsStreaming();
  if (!send || streaming) return undefined;
  return () => {
    triggerAction(send);
  };
}

// Media URLs from the tools are app-relative (`/storyboard-media/…`); the phone
// needs them absolute against the worker. Anything already absolute passes
// through untouched.
function mediaUri(src?: string | null): string | undefined {
  if (!src) return undefined;
  return /^(https?:|data:|file:)/.test(src) ? src : apiUrl(src);
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
 *
 * MediaGrid also puts each tile's Galeria index here, so a `MediaItem` knows
 * its position in the grid's url list without the parent having to re-render it
 * by hand.
 */
type Selection = {
  has: (key: string) => boolean;
  toggle: (key: string) => void;
} | null;

const SelectionContext = createContext<Selection>(null);
const GaleriaIndexContext = createContext<Map<string, number> | null>(null);

function useSelection(): Selection {
  return useContext(SelectionContext);
}

/**
 * State + the confirm button for a `select: "many"` list. In "one" mode both
 * returned pieces are pass-throughs, so callers keep one code path.
 */
function useMultiSelect({
  select,
  send,
  confirm,
}: {
  select?: 'one' | 'many';
  send?: string | null;
  confirm?: string | null;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const many = select === 'many';

  const value = useMemo<Selection>(
    () =>
      many
        ? {
            has: (key: string) => picked.has(key),
            toggle: (key: string) =>
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

  const Provider = ({ children }: { children: ReactNode }) =>
    many ? (
      <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
    ) : (
      <>{children}</>
    );

  // The message is only well-formed once something is picked, so an empty
  // selection yields no handler and the button stays disabled.
  const submit = useSend(
    many && picked.size && send ? `${send}: ${[...picked].join(', ')}` : null,
  );

  const Footer = () =>
    many ? (
      <SemiPillButton
        title={`${confirm || 'Continue'}${picked.size ? ` (${picked.size})` : ''}`}
        onPress={submit}
        disabled={!submit}
        variant="bounce"
        className="mt-3"
      />
    ) : null;

  return { Provider, Footer };
}

/** A small checkbox square — RN has no native one, and this matches the app. */
function CheckSquare({ checked }: { checked: boolean }) {
  const colors = useColors();
  return (
    <View
      className="h-5 w-5 items-center justify-center rounded-md border"
      style={{
        borderColor: checked ? colors.primary : colors.border,
        backgroundColor: checked ? colors.primary : 'transparent',
      }}
    >
      {checked ? <Check size={13} color={colors.primaryForeground} /> : null}
    </View>
  );
}

function Header({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <RNText className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </RNText>
  );
}

/** The inset grouped card — the model picker's shell, reused verbatim. */
function InsetCard({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-[28px] border border-border bg-card">{children}</View>
  );
}

/** The hairline between rows, inset from the left the way iOS insets it. */
function RowSeparator() {
  return <View className="ml-4 h-px bg-border" />;
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

export function Card({ props, renderNode }: Render<CardProps>) {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <View className="w-full gap-3 self-stretch">
      {children.map((child, i) => (
        <View key={i}>{renderNode(child)}</View>
      ))}
    </View>
  );
}

export function Section({ props, renderNode }: Render<SectionProps>) {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <View className="gap-2.5">
      <View>
        <RNText className="text-[15px] font-semibold text-foreground">{props.title}</RNText>
        {props.subtitle ? (
          <RNText className="mt-0.5 text-[13px] text-muted-foreground">{props.subtitle}</RNText>
        ) : null}
      </View>
      <View className="h-px bg-border" />
      {children.map((child, i) => (
        <View key={i}>{renderNode(child)}</View>
      ))}
    </View>
  );
}

const TEXT_STYLES: Record<string, string> = {
  body: 'text-[15px] leading-[21px] text-foreground',
  muted: 'text-[13px] leading-[18px] text-muted-foreground',
  strong: 'text-[15px] font-semibold text-foreground',
  title: 'text-[16px] font-semibold text-foreground',
};

export function Text({ props }: Render<TextProps>) {
  return <RNText className={TEXT_STYLES[props.style ?? 'body']}>{props.text}</RNText>;
}

// Callout tints are alpha-suffixed brand hex (RN accepts #RRGGBBAA), because
// these four colors are constants across schemes — same trick the old amber
// question card used.
const CALLOUT_TONE = {
  info: 'info',
  success: 'primary',
  warning: 'amber',
  danger: 'destructive',
} as const;

export function Callout({ props }: Render<CalloutProps>) {
  const colors = useColors();
  const tone = colors[CALLOUT_TONE[props.variant] ?? 'info'];
  return (
    <View
      className="gap-1 rounded-2xl border p-3"
      style={{ borderColor: `${tone}55`, backgroundColor: `${tone}14` }}
    >
      <RNText className="text-[15px] font-medium text-foreground">{props.title}</RNText>
      {props.description ? (
        <RNText className="text-[13px] leading-[18px] text-muted-foreground">
          {props.description}
        </RNText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export function Option({ props }: Render<OptionProps>) {
  const colors = useColors();
  const selection = useSelection();
  const send = useSend(props.send);
  const danger = props.tone === 'danger';
  const uri = mediaUri(props.image);
  // In a "many" list the row toggles into the parent's selection instead of
  // sending; `checked` then drives the checkbox, while `selected` (the model's
  // "this is already in force" flag) still drives the single-select check mark.
  const checked = selection ? selection.has(props.send) : false;
  const onPress = selection ? (send ? () => selection.toggle(props.send) : undefined) : send;
  // Once the card is answered the row the author took is marked like any other
  // current selection, and the rows they passed over recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;
  return (
    <BouncyPressable
      onPress={onPress}
      disabled={!onPress}
      pressedScale={0.985}
      accessibilityLabel={props.title}
      className="flex-row items-center gap-3 px-4 py-4"
      style={{
        backgroundColor: picked ? `${colors.primary}14` : undefined,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {selection ? <CheckSquare checked={checked} /> : null}
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          transition={120}
          style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.muted }}
        />
      ) : null}
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <RNText
            className={cn(
              'flex-1 text-[16px] font-medium',
              danger ? 'text-destructive' : 'text-foreground',
            )}
            numberOfLines={1}
          >
            {props.title}
          </RNText>
          {props.badge ? (
            <View className="rounded-full bg-secondary px-2 py-0.5">
              <RNText className="text-[11px] font-medium text-muted-foreground">
                {props.badge}
              </RNText>
            </View>
          ) : null}
        </View>
        {props.subtitle ? (
          <RNText className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
            {props.subtitle}
          </RNText>
        ) : null}
      </View>
      {props.meta ? (
        <RNText className="text-[13px] text-muted-foreground">{props.meta}</RNText>
      ) : null}
      {/* A multi-select row's affordance is its checkbox — no chevron, or the
          row would advertise a navigation it doesn't do. A passed-over row on an
          answered card gets neither: there is nothing left to navigate to. */}
      {selection ? null : marked ? (
        <Check size={18} color={colors.primary} />
      ) : dimmed ? null : (
        <ChevronRight size={16} color={colors.subtleForeground} />
      )}
    </BouncyPressable>
  );
}

export function OptionList({ props, renderNode }: Render<OptionListProps>) {
  const options = Array.isArray(props.options) ? props.options : [];
  const { Provider, Footer } = useMultiSelect(props);
  return (
    <View>
      <Header>{props.header}</Header>
      <Provider>
        <InsetCard>
          {options.map((opt, i) => (
            <Fragment key={i}>
              {i > 0 ? <RowSeparator /> : null}
              {renderNode(opt)}
            </Fragment>
          ))}
        </InsetCard>
        <Footer />
      </Provider>
      {props.footnote ? (
        <RNText className="px-1 pt-1.5 text-[13px] text-muted-foreground">{props.footnote}</RNText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * A pickable thumbnail. The two gestures are deliberately separate: TAPPING THE
 * IMAGE opens Galeria's full-screen swipeable preview (the same shared-element
 * transition the Assets and Visual World grids use — you should be able to
 * actually look at a reference before committing to it), while picking is the
 * explicit control underneath: a "Use this" button in a single-select grid, a
 * checkbox row in a multi-select one.
 */
export function MediaItem({ props }: Render<MediaItemProps>) {
  const colors = useColors();
  const selection = useSelection();
  const indices = useContext(GaleriaIndexContext);
  const send = useSend(props.send);
  const uri = mediaUri(props.src);
  const checked = selection ? selection.has(props.send) : false;
  const pick = selection ? (send ? () => selection.toggle(props.send) : undefined) : send;
  // The tile the author picked keeps its ring once the card is answered; the
  // ones they passed over recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;
  // -1 when the tile somehow isn't in its grid's url list (a MediaItem rendered
  // outside a MediaGrid); Galeria treats it as a single-image preview.
  const index = indices?.get(props.src) ?? 0;

  return (
    <View className="gap-1.5" style={{ opacity: dimmed ? 0.45 : 1 }}>
      <View
        className="overflow-hidden rounded-2xl border-2"
        style={{ borderColor: marked || checked ? colors.primary : 'transparent' }}
      >
        <Galeria.Image index={index} style={{ width: '100%', aspectRatio: 1 }}>
          <Image
            source={uri ? { uri } : undefined}
            accessibilityLabel={props.label || 'image'}
            contentFit="cover"
            transition={140}
            style={{ width: '100%', height: '100%', backgroundColor: colors.muted }}
          />
        </Galeria.Image>
        {marked && !selection ? (
          <View
            className="absolute left-1.5 top-1.5 rounded-full p-1"
            style={{ backgroundColor: colors.primary }}
          >
            <Check size={11} color={colors.primaryForeground} />
          </View>
        ) : null}
      </View>
      {props.label ? (
        <RNText className="px-1 text-[13px] font-medium text-foreground" numberOfLines={1}>
          {props.label}
        </RNText>
      ) : null}
      {props.caption ? (
        <RNText className="px-1 text-[12px] leading-[16px] text-muted-foreground" numberOfLines={2}>
          {props.caption}
        </RNText>
      ) : null}
      {selection ? (
        <BouncyPressable
          onPress={pick}
          disabled={!pick}
          pressedScale={0.97}
          accessibilityLabel={`${checked ? 'Unpick' : 'Pick'} ${props.label || 'image'}`}
          className="flex-row items-center gap-2 px-1 py-1"
        >
          <CheckSquare checked={checked} />
          <RNText className="text-[13px] text-muted-foreground">
            {checked ? 'Picked' : 'Pick'}
          </RNText>
        </BouncyPressable>
      ) : (
        <BouncyPressable
          onPress={pick}
          disabled={!pick}
          pressedScale={0.97}
          accessibilityLabel={`Use ${props.label || 'this image'}`}
          className="items-center rounded-xl border border-border bg-secondary py-2"
        >
          <RNText className="text-[13px] font-medium text-foreground">Use this</RNText>
        </BouncyPressable>
      )}
    </View>
  );
}

export function MediaGrid({ props, renderNode }: Render<MediaGridProps>) {
  const scheme = useEffectiveScheme();
  const items = Array.isArray(props.items) ? props.items : [];
  const columns = props.columns === 3 ? 3 : 2;
  const { Provider, Footer } = useMultiSelect(props);
  // Percentage widths inside a wrapping row — RN has no CSS grid, and a
  // fixed-column FlatList inside the chat's scroll view would nest scrollables.
  const width = columns === 3 ? '31.5%' : '48.5%';

  // Galeria previews the WHOLE grid, swipeable — so it needs every url up front
  // and each tile needs its position in that list. The tiles render through
  // `renderNode`, so the position rides down on a context rather than a prop.
  const { urls, indices } = useMemo(() => {
    const list: string[] = [];
    const map = new Map<string, number>();
    for (const item of items) {
      const src = (item as { props?: MediaItemProps })?.props?.src;
      const uri = mediaUri(src);
      if (!src || !uri || map.has(src)) continue;
      map.set(src, list.length);
      list.push(uri);
    }
    return { urls: list, indices: map };
  }, [items]);

  return (
    <View>
      <Header>{props.header}</Header>
      <Provider>
        <GaleriaIndexContext.Provider value={indices}>
          <Galeria urls={urls} theme={scheme}>
            <View className="flex-row flex-wrap gap-2">
              {items.map((item, i) => (
                <View key={i} style={{ width }}>
                  {renderNode(item)}
                </View>
              ))}
            </View>
          </Galeria>
        </GaleriaIndexContext.Provider>
        <Footer />
      </Provider>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export function Recommendation({ props }: Render<RecommendationProps>) {
  const colors = useColors();
  const scheme = useEffectiveScheme();
  const onPress = useSend(props.send);
  const bullets = Array.isArray(props.bullets) ? props.bullets : [];
  const uri = mediaUri(props.image);
  return (
    <InsetCard>
      {uri ? (
        // Tappable for the same full-screen look a MediaGrid tile gives — a
        // preview thumbnail at 148pt is not enough to judge a render by.
        <Galeria urls={[uri]} theme={scheme}>
          <Galeria.Image index={0} style={{ width: '100%', height: 148 }}>
            <Image
              source={{ uri }}
              accessibilityLabel={props.title}
              contentFit="cover"
              transition={140}
              style={{ width: '100%', height: '100%', backgroundColor: colors.muted }}
            />
          </Galeria.Image>
        </Galeria>
      ) : null}
      <View className="gap-3 p-4">
        <View>
          <View className="flex-row items-center gap-2">
            <RNText className="flex-1 text-[17px] font-semibold text-foreground">
              {props.title}
            </RNText>
            {props.badge ? (
              <View
                className="rounded-full px-2 py-0.5"
                style={{ backgroundColor: `${colors.primary}1f` }}
              >
                <RNText className="text-[11px] font-medium" style={{ color: colors.primary }}>
                  {props.badge}
                </RNText>
              </View>
            ) : null}
          </View>
          <RNText className="mt-1 text-[14px] leading-[20px] text-muted-foreground">
            {props.body}
          </RNText>
        </View>
        {bullets.length ? (
          <View className="gap-1.5">
            {bullets.slice(0, 4).map((b, i) => (
              <View key={i} className="flex-row items-start gap-2">
                <Check size={13} color={colors.primary} style={{ marginTop: 3 }} />
                <RNText className="flex-1 text-[13px] leading-[18px] text-muted-foreground">
                  {b}
                </RNText>
              </View>
            ))}
          </View>
        ) : null}
        {props.meta ? (
          <RNText className="text-[12px] text-muted-foreground">{props.meta}</RNText>
        ) : null}
        {/* The hero slab — the same button the Discover story's "Try this" uses. */}
        <SemiPillButton
          title={props.cta || 'Continue'}
          onPress={onPress}
          disabled={!onPress}
          className="mt-0.5"
        />
      </View>
    </InsetCard>
  );
}

// ---------------------------------------------------------------------------
// Comparison & detail
// ---------------------------------------------------------------------------

export function Column({ props }: Render<ColumnProps>) {
  const colors = useColors();
  const onPress = useSend(props.send);
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const body = (
    <>
      <View className="flex-row items-center gap-1">
        <RNText className="flex-1 text-[13px] font-semibold text-foreground" numberOfLines={1}>
          {props.label}
        </RNText>
      </View>
      {props.badge ? (
        <View
          className="self-start rounded-full px-1.5 py-0.5"
          style={{ backgroundColor: `${colors.primary}1f` }}
        >
          <RNText className="text-[10px] font-medium" style={{ color: colors.primary }}>
            {props.badge}
          </RNText>
        </View>
      ) : null}
      {rows.map((row, i) => (
        <View key={i}>
          <RNText className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.label}
          </RNText>
          <RNText className="text-[13px] text-foreground">{row.value}</RNText>
        </View>
      ))}
    </>
  );

  // A pickable column bounces; a purely informational one is a plain view, so
  // it doesn't advertise a tap that does nothing.
  if (!onPress) {
    return (
      <View className="flex-1 gap-1.5 rounded-2xl border border-border bg-card p-3">{body}</View>
    );
  }
  return (
    <BouncyPressable
      onPress={onPress}
      accessibilityLabel={props.label}
      className="flex-1 gap-1.5 rounded-2xl border border-border bg-card p-3"
    >
      {body}
    </BouncyPressable>
  );
}

export function Compare({ props, renderNode }: Render<CompareProps>) {
  const columns = Array.isArray(props.columns) ? props.columns.slice(0, 3) : [];
  return (
    <View>
      <Header>{props.header}</Header>
      <View className="flex-row gap-2">
        {columns.map((col, i) => (
          <View key={i} className="flex-1">
            {renderNode(col)}
          </View>
        ))}
      </View>
    </View>
  );
}

export function KeyValue({ props }: Render<KeyValueProps>) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  return (
    <View>
      <Header>{props.header}</Header>
      <InsetCard>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <RowSeparator /> : null}
            <View className="flex-row items-start gap-3 px-4 py-3">
              <RNText className="text-[13px] text-muted-foreground">{row.label}</RNText>
              <RNText className="flex-1 text-right text-[13px] font-medium text-foreground">
                {row.value}
              </RNText>
            </View>
          </Fragment>
        ))}
      </InsetCard>
    </View>
  );
}

export function Steps({ props }: Render<StepsProps>) {
  const colors = useColors();
  const steps = Array.isArray(props.steps) ? props.steps : [];
  const current = typeof props.current === 'number' ? props.current : -1;
  return (
    <View>
      <Header>{props.header}</Header>
      <View className="gap-3">
        {steps.map((step, i) => {
          const done = current > i;
          const active = current === i;
          return (
            <View key={i} className="flex-row items-start gap-3">
              <View
                className="h-6 w-6 items-center justify-center rounded-full"
                style={{
                  backgroundColor: done ? colors.primary : 'transparent',
                  borderWidth: done ? 0 : active ? 2 : 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                {done ? (
                  <Check size={12} color={colors.primaryForeground} />
                ) : (
                  <RNText
                    className="text-[11px] font-semibold"
                    style={{ color: active ? colors.primary : colors.mutedForeground }}
                  >
                    {i + 1}
                  </RNText>
                )}
              </View>
              <View className="flex-1">
                <View className="flex-row items-baseline gap-2">
                  <RNText
                    className={cn(
                      'flex-1 text-[15px]',
                      active ? 'font-semibold' : 'font-medium',
                      done ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {step.title}
                  </RNText>
                  {step.meta ? (
                    <RNText className="text-[12px] text-muted-foreground">{step.meta}</RNText>
                  ) : null}
                </View>
                {step.detail ? (
                  <RNText className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
                    {step.detail}
                  </RNText>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function Chip({ label }: { label: string }) {
  const onPress = useSend(label);
  return (
    <BouncyPressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={label}
      className="rounded-full border border-border bg-secondary px-3.5 py-2"
    >
      <RNText className="text-[14px] font-medium text-foreground">{label}</RNText>
    </BouncyPressable>
  );
}

export function Chips({ props }: Render<{ labels?: string[] }>) {
  const labels = Array.isArray(props.labels) ? props.labels : [];
  return (
    <View className="flex-row flex-wrap gap-2">
      {labels.map((label, i) => (
        <Chip key={i} label={label} />
      ))}
    </View>
  );
}

export function Action({ props }: Render<ActionProps>) {
  const colors = useColors();
  const onPress = useSend(props.send);
  const danger = props.tone === 'danger';
  // The button the author pressed reads as pressed once the card is answered —
  // it goes solid, and the ones they didn't press recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const primary = (props.variant === 'primary' || picked) && !danger;
  return (
    <BouncyPressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={props.label}
      className="rounded-xl border px-4 py-2.5"
      style={{
        borderColor: danger ? `${colors.destructive}80` : primary ? colors.primary : colors.border,
        backgroundColor: danger
          ? `${colors.destructive}1a`
          : primary
            ? colors.primary
            : colors.surfaceAlt,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      <RNText
        className="text-[15px] font-medium"
        style={{
          color: danger
            ? colors.destructive
            : primary
              ? colors.primaryForeground
              : colors.foreground,
        }}
      >
        {props.label}
      </RNText>
    </BouncyPressable>
  );
}

export function Actions({ props, renderNode }: Render<ActionsProps>) {
  const actions = Array.isArray(props.actions) ? props.actions : [];
  const column = props.direction === 'column';
  return (
    <View className={cn('gap-2', column ? 'flex-col items-stretch' : 'flex-row flex-wrap')}>
      {actions.map((action, i) => (
        <View key={i}>{renderNode(action)}</View>
      ))}
    </View>
  );
}

/** The mobile design system, in the shape `buildStudioLibrary()` expects. */
export const nativeRenderers: StudioRenderers = {
  Card,
  Section,
  Text,
  Callout,
  Option,
  OptionList,
  MediaItem,
  MediaGrid,
  Recommendation,
  Column,
  Compare,
  KeyValue,
  Steps,
  Chips,
  Action,
  Actions,
} as unknown as StudioRenderers;
