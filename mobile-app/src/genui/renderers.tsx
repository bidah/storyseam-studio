/**
 * The MOBILE renderer set for the Studio generative-UI contract — React Native
 * + react-native-unistyles. One export per component in `StudioRenderers`
 * (contract.ts), matching `src/genui/renderers.jsx` name for name and prop for
 * prop, so a single `render_ui` call draws the same decision on web and on the
 * phone.
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
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Blocks, Check, ChevronRight, Pause, Play, Plus } from 'lucide-react-native';
import { useIsStreaming, useTriggerAction } from '@openuidev/react-lang';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { SemiPillButton } from '@/components/ui/semi-pill-button';
import { useColors } from '@/lib/colors';
import { useEffectiveScheme } from '@/lib/theme';
import { apiUrl, mediaUrl, toImageSrc } from '@/lib/api';
import { useAnswerState } from './answered';
import type {
  ActionProps,
  ActionsProps,
  AudioItemProps,
  AudioListProps,
  CalloutProps,
  CardProps,
  ColumnProps,
  CompareProps,
  KeyValueProps,
  MediaGridProps,
  MediaItemProps,
  OptionListProps,
  OptionProps,
  PluginListProps,
  PluginProps,
  RecommendationProps,
  SectionProps,
  SelectMode,
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

// The src a tile is PAINTED with -> the src its full-screen preview should OPEN.
// Zooming belongs on the ~1600px `display` webp: the thumb is a 400px box, so
// full-screen it is a blown-up blur, and the original is megabytes of detail
// nobody can see on a phone. The model is told to pass `display` and usually
// does; this derives the tier when it forgets — upgrading a `/img/thumb/...`
// tile, stepping a raw original down. Mirrors toZoomSrc in src/lib/previewSrc.js.
function zoomSrc(src?: string | null): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('/img/thumb/')) return '/img/display/' + src.slice('/img/thumb/'.length);
  return toImageSrc(src, 'display');
}

/**
 * Deferred-selection plumbing, shared by OptionList, MediaGrid and AudioList.
 *
 * A list in `select: "many"` or `"one-per-group"` owns the selection and its
 * children only toggle into it — so `Option` / `MediaItem` / `AudioItem` render
 * a pick control instead of firing immediately. The composed message is the
 * list's `send` plus the picked children's `send` values, joined; see the
 * contract's SELECT note for why a deferred item's `send` is a noun phrase.
 *
 * `null` context = single-select, the default: children send on tap.
 *
 * MediaGrid also puts each tile's Galeria index here, so a `MediaItem` knows
 * its position in the grid's url list without the parent having to re-render it
 * by hand.
 */
type Selection = {
  mode: 'many' | 'group';
  has: (key: string) => boolean;
  toggle: (key: string, group?: string) => void;
} | null;

const SelectionContext = createContext<Selection>(null);
const GaleriaIndexContext = createContext<Map<string, number> | null>(null);

function useSelection(): Selection {
  return useContext(SelectionContext);
}

type Bucket = { name: string; items: unknown[] };

/**
 * Split a list's children into the sub-questions they answer.
 *
 * Only `select: "one-per-group"` buckets; every other mode returns the single
 * unnamed bucket that IS the whole list, so grouped and ungrouped lists render
 * through one code path and an ordinary card looks exactly as it always did.
 * Groups come out in first-appearance order — the order the model wrote them,
 * which is the order the composed message has to follow.
 */
function groupItems(items: unknown[], select?: SelectMode): Bucket[] {
  if (select !== 'one-per-group') return [{ name: '', items }];
  const buckets: Bucket[] = [];
  const byName = new Map<string, Bucket>();
  for (const item of items) {
    const name = (item as { props?: { group?: string | null } })?.props?.group || '';
    let bucket = byName.get(name);
    if (!bucket) {
      bucket = { name, items: [] };
      byName.set(name, bucket);
      buckets.push(bucket);
    }
    bucket.items.push(item);
  }
  return buckets;
}

/**
 * State + the confirm button for a list that defers its send. In "one" mode both
 * returned pieces are pass-throughs, so callers keep one code path.
 *
 * `groups` is the bucket order from `groupItems` — it decides both the order the
 * picks are joined in and, in "one-per-group", when the card is COMPLETE. That
 * completeness gate is the point of the mode: a card asking three questions must
 * not be answerable with one, because the send that answers it ends the turn.
 */
function useMultiSelect(
  {
    select,
    send,
    confirm,
  }: {
    select?: SelectMode;
    send?: string | null;
    confirm?: string | null;
  },
  groups: Bucket[],
) {
  // group name → the picked `send` strings for that group. "many" keeps
  // everything under the one unnamed group, in tap order.
  const [picks, setPicks] = useState<Record<string, string[]>>(() => ({}));
  const many = select === 'many';
  const perGroup = select === 'one-per-group';
  const active = many || perGroup;

  const value = useMemo<Selection>(
    () =>
      active
        ? {
            mode: perGroup ? 'group' : 'many',
            has: (key: string) => Object.values(picks).some((list) => list.includes(key)),
            toggle: (key: string, group = '') =>
              setPicks((prev) => {
                const current = prev[group] || [];
                // One-per-group is a radio: a second pick REPLACES the first,
                // and re-tapping the picked one clears it (so a misfire is
                // undoable without having to pick something you don't want).
                if (perGroup) {
                  return { ...prev, [group]: current[0] === key ? [] : [key] };
                }
                return {
                  ...prev,
                  [group]: current.includes(key)
                    ? current.filter((k) => k !== key)
                    : [...current, key],
                };
              }),
          }
        : null,
    [active, perGroup, picks],
  );

  const Provider = ({ children }: { children: ReactNode }) =>
    active ? (
      <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
    ) : (
      <>{children}</>
    );

  const names = perGroup ? groups.map((g) => g.name) : [''];
  const chosen = names.flatMap((name) => picks[name] || []);
  const complete = perGroup
    ? names.every((name) => (picks[name] || []).length > 0)
    : chosen.length > 0;

  // The message is only well-formed once the card is fully answered, so an
  // incomplete selection yields no handler and the button stays disabled.
  const submit = useSend(active && complete && send ? `${send}: ${chosen.join(', ')}` : null);

  // "2 of 3" while the card is still asking; a plain count once it's a bag of
  // picks with no target number.
  const count = perGroup
    ? chosen.length < names.length
      ? ` (${chosen.length}/${names.length})`
      : ''
    : chosen.length
      ? ` (${chosen.length})`
      : '';

  const Footer = () =>
    active ? (
      <SemiPillButton
        title={`${confirm || 'Continue'}${count}`}
        onPress={submit}
        disabled={!submit}
        variant="bounce"
        style={styles.footerCta}
      />
    ) : null;

  return { Provider, Footer };
}

/** A small checkbox square — RN has no native one, and this matches the app. */
function CheckSquare({ checked }: { checked: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.checkSquare,
        {
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: checked ? colors.primary : 'transparent',
        },
      ]}
    >
      {checked ? <Check size={13} color={colors.primaryForeground} /> : null}
    </View>
  );
}

/**
 * The pick indicator for a deferred-select row: a checkbox when several answers
 * are allowed, a radio when the group takes exactly one. The shape is the only
 * honest hint about how many picks a group will accept.
 */
function PickMark({ mode, checked }: { mode: 'many' | 'group'; checked: boolean }) {
  const colors = useColors();
  if (mode !== 'group') return <CheckSquare checked={checked} />;
  return (
    <View style={[styles.radio, { borderColor: checked ? colors.primary : colors.border }]}>
      {checked ? (
        <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />
      ) : null}
    </View>
  );
}

function Header({ children }: { children?: string | null }) {
  if (!children) return null;
  return <RNText style={styles.header}>{children}</RNText>;
}

/** The inset grouped card — the model picker's shell, reused verbatim. */
function InsetCard({ children }: { children: ReactNode }) {
  return <View style={styles.insetCard}>{children}</View>;
}

/** The hairline between rows, inset from the left the way iOS insets it. */
function RowSeparator() {
  return <View style={styles.rowSeparator} />;
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

export function Card({ props, renderNode }: Render<CardProps>) {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <View style={styles.card}>
      {children.map((child, i) => (
        <View key={i}>{renderNode(child)}</View>
      ))}
    </View>
  );
}

export function Section({ props, renderNode }: Render<SectionProps>) {
  const children = Array.isArray(props.children) ? props.children : [];
  return (
    <View style={styles.section}>
      <View>
        <RNText style={styles.sectionTitle}>{props.title}</RNText>
        {props.subtitle ? (
          <RNText style={styles.sectionSubtitle}>{props.subtitle}</RNText>
        ) : null}
      </View>
      <View style={styles.divider} />
      {children.map((child, i) => (
        <View key={i}>{renderNode(child)}</View>
      ))}
    </View>
  );
}

const TEXT_STYLES: Record<string, 'textBody' | 'textMuted' | 'textStrong' | 'textTitle'> = {
  body: 'textBody',
  muted: 'textMuted',
  strong: 'textStrong',
  title: 'textTitle',
};

export function Text({ props }: Render<TextProps>) {
  const variant = TEXT_STYLES[props.style ?? 'body'];
  return <RNText style={variant ? styles[variant] : undefined}>{props.text}</RNText>;
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
    <View style={[styles.callout, { borderColor: `${tone}55`, backgroundColor: `${tone}14` }]}>
      <RNText style={styles.calloutTitle}>{props.title}</RNText>
      {props.description ? (
        <RNText style={styles.subtitleNoMargin}>{props.description}</RNText>
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
  const onPress = selection
    ? send
      ? () => selection.toggle(props.send, props.group || '')
      : undefined
    : send;
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
      style={[
        styles.row,
        {
          backgroundColor: picked ? `${colors.primary}14` : undefined,
          opacity: dimmed ? 0.45 : 1,
        },
      ]}
    >
      {selection ? <PickMark mode={selection.mode} checked={checked} /> : null}
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          transition={120}
          style={{ width: 40, height: 40, borderRadius: 0, backgroundColor: colors.muted }}
        />
      ) : null}
      <View style={styles.flex1}>
        <View style={styles.rowTitleLine}>
          <RNText
            style={[styles.rowTitle, danger && styles.rowTitleDanger]}
            numberOfLines={1}
          >
            {props.title}
          </RNText>
          {props.badge ? (
            <View style={styles.badge}>
              <RNText style={styles.badgeText}>{props.badge}</RNText>
            </View>
          ) : null}
        </View>
        {props.subtitle ? (
          <RNText style={styles.subtitle}>{props.subtitle}</RNText>
        ) : null}
      </View>
      {props.meta ? <RNText style={styles.meta}>{props.meta}</RNText> : null}
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
  const buckets = useMemo(() => groupItems(options, props.select), [options, props.select]);
  const { Provider, Footer } = useMultiSelect(props, buckets);
  return (
    <View>
      <Header>{props.header}</Header>
      <Provider>
        <View style={styles.stack}>
          {buckets.map((bucket, b) => (
            <View key={b}>
              <Header>{bucket.name}</Header>
              <InsetCard>
                {bucket.items.map((opt, i) => (
                  <Fragment key={i}>
                    {i > 0 ? <RowSeparator /> : null}
                    {renderNode(opt)}
                  </Fragment>
                ))}
              </InsetCard>
            </View>
          ))}
        </View>
        <Footer />
      </Provider>
      {props.footnote ? <RNText style={styles.footnote}>{props.footnote}</RNText> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * A thumbnail. The two gestures are deliberately separate: TAPPING THE IMAGE
 * opens Galeria's full-screen swipeable preview (the same shared-element
 * transition the Assets and Visual World grids use — you should be able to
 * actually look at a reference before committing to it), while picking is the
 * explicit control underneath: a "Use this" button in a single-select grid, a
 * checkbox row in a multi-select one.
 *
 * Only tiles given a `send` get that control, so a card that merely SHOWS the
 * author a picture the agent just generated is just thumbnails they can open.
 * Same rule as AudioItem's listen-only rows.
 */
export function MediaItem({ props }: Render<MediaItemProps>) {
  const colors = useColors();
  const selection = useSelection();
  const indices = useContext(GaleriaIndexContext);
  const send = useSend(props.send);
  const uri = mediaUri(props.src);
  const checked = selection && props.send ? selection.has(props.send) : false;
  const pick = selection
    ? send && props.send
      ? () => selection.toggle(props.send!, props.group || '')
      : undefined
    : send;
  // The tile the author picked keeps its ring once the card is answered; the
  // ones they passed over recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;
  // -1 when the tile somehow isn't in its grid's url list (a MediaItem rendered
  // outside a MediaGrid); Galeria treats it as a single-image preview.
  const index = indices?.get(props.src) ?? 0;

  return (
    <View style={[styles.mediaItem, { opacity: dimmed ? 0.45 : 1 }]}>
      <View
        style={[
          styles.mediaFrame,
          { borderColor: marked || checked ? colors.primary : 'transparent' },
        ]}
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
          <View style={[styles.mediaCheckPip, { backgroundColor: colors.primary }]}>
            <Check size={11} color={colors.primaryForeground} />
          </View>
        ) : null}
      </View>
      {props.label ? (
        <RNText style={styles.mediaLabel} numberOfLines={1}>
          {props.label}
        </RNText>
      ) : null}
      {props.caption ? (
        <RNText style={styles.mediaCaption} numberOfLines={2}>
          {props.caption}
        </RNText>
      ) : null}
      {/* One-per-group keeps the "Use this" button of a single-select grid —
          the gesture is the same, it just doesn't send yet — and goes solid
          once it's this group's answer. A "many" grid gets the checkbox row
          instead, because there the question is how many, not which one. */}
      {selection?.mode === 'group' && props.send ? (
        <BouncyPressable
          onPress={pick}
          disabled={!pick}
          pressedScale={0.97}
          accessibilityLabel={`${checked ? 'Unpick' : 'Use'} ${props.label || 'this image'}`}
          style={[styles.useBtn, checked ? styles.useBtnChecked : styles.useBtnIdle]}
        >
          {checked ? <Check size={13} color={colors.primaryForeground} /> : null}
          <RNText style={[styles.smallBtnText, checked && styles.smallBtnTextChecked]}>
            {checked ? 'Picked' : 'Use this'}
          </RNText>
        </BouncyPressable>
      ) : selection && props.send ? (
        <BouncyPressable
          onPress={pick}
          disabled={!pick}
          pressedScale={0.97}
          accessibilityLabel={`${checked ? 'Unpick' : 'Pick'} ${props.label || 'image'}`}
          style={styles.pickRow}
        >
          <CheckSquare checked={checked} />
          <RNText style={styles.meta}>{checked ? 'Picked' : 'Pick'}</RNText>
        </BouncyPressable>
      ) : props.send ? (
        <BouncyPressable
          onPress={pick}
          disabled={!pick}
          pressedScale={0.97}
          accessibilityLabel={`Use ${props.label || 'this image'}`}
          style={styles.useBtnSingle}
        >
          <RNText style={styles.smallBtnText}>Use this</RNText>
        </BouncyPressable>
      ) : null}
    </View>
  );
}

export function MediaGrid({ props, renderNode }: Render<MediaGridProps>) {
  const scheme = useEffectiveScheme();
  const items = Array.isArray(props.items) ? props.items : [];
  const columns = props.columns === 3 ? 3 : 2;
  const buckets = useMemo(() => groupItems(items, props.select), [items, props.select]);
  const { Provider, Footer } = useMultiSelect(props, buckets);
  // Percentage widths inside a wrapping row — RN has no CSS grid, and a
  // fixed-column FlatList inside the chat's scroll view would nest scrollables.
  //
  // ONE tile takes the whole rail. A lone image in a 2-up grid sat in the left
  // half with dead space beside it and a half-width "Use this" under it, which
  // reads as a column that failed to fill rather than as the picture the card
  // is about — and on a phone that half is small enough to be worth nothing.
  // Judged per group, so a subject with a single candidate still fills its row.
  const widthFor = (count: number) =>
    count === 1 ? '100%' : columns === 3 ? '31.5%' : '48.5%';

  // Galeria previews the WHOLE grid, swipeable — so it needs every url up front
  // and each tile needs its position in that list. The tiles render through
  // `renderNode`, so the position rides down on a context rather than a prop.
  const { urls, indices } = useMemo(() => {
    const list: string[] = [];
    const map = new Map<string, number>();
    for (const item of items) {
      const p = (item as { props?: MediaItemProps })?.props;
      const src = p?.src;
      // The tile paints from `src` (the small thumb), but tapping opens the
      // full-screen preview — which should be the larger `display` webp, not the
      // thumb blown up. Key the index by `src` (what the tile knows itself as),
      // point Galeria's url at `display`, or at the tier derived from `src` when
      // the model didn't pass one.
      const uri = mediaUri(p?.display || zoomSrc(src));
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
          {/* Galeria wraps ALL the buckets: swiping full-screen runs through the
              whole card's images, not just the group the tile came from. */}
          <Galeria urls={urls} theme={scheme}>
            <View style={styles.stack}>
              {buckets.map((bucket, b) => (
                <View key={b}>
                  <Header>{bucket.name}</Header>
                  <View style={styles.wrapRow}>
                    {bucket.items.map((item, i) => (
                      <View key={i} style={{ width: widthFor(bucket.items.length) }}>
                        {renderNode(item)}
                      </View>
                    ))}
                  </View>
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
// Audio
// ---------------------------------------------------------------------------

/**
 * One clip at a time per card. The list owns which row is playing (keyed by
 * src) and rows toggle into it — same one-player rule as the Sounds tab. A
 * stray AudioItem outside an AudioList falls back to its own local state.
 */
type AudioPlayback = { activeKey: string | null; toggle: (key: string) => void };

const AudioPlaybackContext = createContext<AudioPlayback | null>(null);

/**
 * The single mounted expo-audio player — keyed by URL so switching rows
 * remounts it (useAudioPlayer doesn't chase source changes); unmount releases
 * it. Same pattern as the Sounds tab's AudioHost.
 */
function AudioHost({ url, onDone }: { url: string; onDone: () => void }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    player.play();
  }, [player]);
  useEffect(() => {
    if (status.didJustFinish) onDone();
  }, [status.didJustFinish, onDone]);
  return null;
}

/**
 * One playable clip. Mirrors MediaItem's split gestures: TAPPING THE ROW
 * plays/pauses the clip, while picking is the explicit trailing control — and
 * only rows given a `send` have one, so a listen-only card is just rows.
 */
export function AudioItem({ props }: Render<AudioItemProps>) {
  const colors = useColors();
  const selection = useSelection();
  const playback = useContext(AudioPlaybackContext);
  const [localKey, setLocalKey] = useState<string | null>(null);
  const send = useSend(props.send);
  // Native players send no headers, so the project id must ride the URL —
  // mediaUrl, not apiUrl (the same reason the Sounds tab uses it).
  const url = mediaUrl(props.src);
  const playing = playback ? playback.activeKey === props.src : localKey === props.src;
  const togglePlay = () => {
    if (!url) return;
    if (playback) playback.toggle(props.src);
    else setLocalKey((cur) => (cur === props.src ? null : props.src));
  };
  const stop = () => {
    if (playback) {
      if (playback.activeKey === props.src) playback.toggle(props.src);
    } else setLocalKey(null);
  };
  const checked = selection && props.send ? selection.has(props.send) : false;
  const pick = selection
    ? send && props.send
      ? () => selection.toggle(props.send!, props.group || '')
      : undefined
    : send;
  const { picked, dimmed } = useAnswerState(props.send);
  const marked = props.selected || picked;

  return (
    <BouncyPressable
      onPress={togglePlay}
      disabled={!url}
      pressedScale={0.985}
      accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${props.title}`}
      style={[
        styles.row,
        {
          backgroundColor: picked ? `${colors.primary}14` : undefined,
          opacity: dimmed ? 0.45 : 1,
        },
      ]}
    >
      {playing && url ? <AudioHost url={url} onDone={stop} /> : null}
      <View
        style={[
          styles.playCircle,
          {
            borderColor: playing ? colors.primary : colors.border,
            backgroundColor: playing ? colors.primary : 'transparent',
          },
        ]}
      >
        {playing ? (
          <Pause size={16} color={colors.primaryForeground} />
        ) : (
          <Play size={16} color={colors.foreground} style={{ marginLeft: 2 }} />
        )}
      </View>
      <View style={styles.flex1}>
        <View style={styles.rowTitleLine}>
          <RNText style={styles.rowTitle} numberOfLines={1}>
            {props.title}
          </RNText>
          {props.badge ? (
            <View style={styles.badge}>
              <RNText style={styles.badgeText}>{props.badge}</RNText>
            </View>
          ) : null}
        </View>
        {props.subtitle ? (
          <RNText style={styles.subtitle}>{props.subtitle}</RNText>
        ) : null}
      </View>
      {props.meta ? <RNText style={styles.meta}>{props.meta}</RNText> : null}
      {selection && props.send ? (
        <BouncyPressable
          onPress={pick}
          disabled={!pick}
          pressedScale={0.9}
          accessibilityLabel={`${checked ? 'Unpick' : 'Pick'} ${props.title}`}
          style={styles.pickTap}
        >
          <PickMark mode={selection.mode} checked={checked} />
        </BouncyPressable>
      ) : props.send ? (
        marked ? (
          <Check size={18} color={colors.primary} />
        ) : (
          <BouncyPressable
            onPress={pick}
            disabled={!pick}
            pressedScale={0.95}
            accessibilityLabel={`Use ${props.title}`}
            style={styles.usePill}
          >
            <RNText style={styles.smallBtnText}>Use</RNText>
          </BouncyPressable>
        )
      ) : null}
    </BouncyPressable>
  );
}

export function AudioList({ props, renderNode }: Render<AudioListProps>) {
  const items = Array.isArray(props.items) ? props.items : [];
  const buckets = useMemo(() => groupItems(items, props.select), [items, props.select]);
  const { Provider, Footer } = useMultiSelect(props, buckets);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const playback = useMemo<AudioPlayback>(
    () => ({ activeKey, toggle: (key) => setActiveKey((cur) => (cur === key ? null : key)) }),
    [activeKey],
  );
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);
  return (
    <View>
      <Header>{props.header}</Header>
      <Provider>
        <AudioPlaybackContext.Provider value={playback}>
          <View style={styles.stack}>
            {buckets.map((bucket, b) => (
              <View key={b}>
                <Header>{bucket.name}</Header>
                <InsetCard>
                  {bucket.items.map((item, i) => (
                    <Fragment key={i}>
                      {i > 0 ? <RowSeparator /> : null}
                      {renderNode(item)}
                    </Fragment>
                  ))}
                </InsetCard>
              </View>
            ))}
          </View>
        </AudioPlaybackContext.Provider>
        <Footer />
      </Provider>
      {props.footnote ? <RNText style={styles.footnote}>{props.footnote}</RNText> : null}
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
  const zoomUri = mediaUri(zoomSrc(props.image));
  return (
    <InsetCard>
      {uri ? (
        // Tappable for the same full-screen look a MediaGrid tile gives — a
        // preview thumbnail at 148pt is not enough to judge a render by, and
        // what opens is the display tier, not the 148pt tile's own bytes.
        <Galeria urls={[zoomUri ?? uri]} theme={scheme}>
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
      <View style={styles.recBody}>
        <View>
          <View style={styles.recTitleRow}>
            <RNText style={styles.recTitle}>{props.title}</RNText>
            {props.badge ? (
              <View style={styles.tintBadge}>
                <RNText style={styles.tintBadgeText}>{props.badge}</RNText>
              </View>
            ) : null}
          </View>
          <RNText style={styles.recBodyText}>{props.body}</RNText>
        </View>
        {bullets.length ? (
          <View style={styles.bullets}>
            {bullets.slice(0, 4).map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <Check size={13} color={colors.primary} style={{ marginTop: 3 }} />
                <RNText style={styles.bulletText}>{b}</RNText>
              </View>
            ))}
          </View>
        ) : null}
        {props.meta ? <RNText style={styles.meta12}>{props.meta}</RNText> : null}
        {/* The hero slab — the same button the Discover story's "Try this" uses. */}
        <SemiPillButton
          title={props.cta || 'Continue'}
          onPress={onPress}
          disabled={!onPress}
          style={styles.recCta}
        />
      </View>
    </InsetCard>
  );
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

/**
 * One row of the marketplace, in the chat. Adding a capability to the studio is
 * a different decision from picking a take, so it isn't an Option row: the
 * shelf it sits on, the name, what it unlocks, and one install slab.
 *
 * A plugin the project already HAS is settled — a tinted "Installed" badge and
 * no button, because there is nothing left to decide. Everything else gets the
 * SemiPillButton carrying the `send`; the agent installs nothing itself.
 */
export function Plugin({ props }: Render<PluginProps>) {
  const colors = useColors();
  const onPress = useSend(props.send);
  const highlights = Array.isArray(props.highlights) ? props.highlights : [];
  // Once the card is answered the plugin the author installed reads as taken
  // and the ones they passed over recede. See answered.ts.
  const { picked, dimmed } = useAnswerState(props.send);
  return (
    <View style={[styles.pluginBody, { opacity: dimmed ? 0.45 : 1 }]}>
      <View style={styles.pluginHead}>
        <View style={[styles.pluginIcon, { borderColor: colors.border }]}>
          <Blocks size={18} color={colors.mutedForeground} />
        </View>
        <View style={styles.flex1}>
          {props.category ? (
            <RNText style={styles.pluginCategory}>{props.category}</RNText>
          ) : null}
          <View style={styles.rowTitleLine}>
            <RNText style={styles.pluginName} numberOfLines={1}>
              {props.name}
            </RNText>
            {props.installed ? (
              <View style={styles.tintBadge}>
                <RNText style={styles.tintBadgeText}>Installed</RNText>
              </View>
            ) : props.badge ? (
              <View style={styles.badge}>
                <RNText style={styles.badgeText}>{props.badge}</RNText>
              </View>
            ) : null}
          </View>
          <RNText style={styles.subtitle}>{props.tagline}</RNText>
        </View>
        {props.meta ? <RNText style={styles.meta}>{props.meta}</RNText> : null}
      </View>
      {highlights.length ? (
        <View style={styles.bullets}>
          {highlights.slice(0, 4).map((line, i) => (
            <View key={i} style={styles.bulletRow}>
              <Check size={13} color={colors.primary} style={{ marginTop: 3 }} />
              <RNText style={styles.bulletText}>{line}</RNText>
            </View>
          ))}
        </View>
      ) : null}
      {/* An installed plugin has no control at all — the badge above already
          says everything true about it. */}
      {props.installed ? null : (
        <SemiPillButton
          title={`Install ${props.name}`}
          onPress={onPress}
          disabled={!onPress}
          variant="bounce"
          accessibilityLabel={`Install the ${props.name} plugin`}
        >
          {/* The slab's fill IS the page's text colour, so its contents take
              the page background — same inversion SemiPillButton's label does. */}
          {picked ? (
            <Check size={17} color={colors.pageBg} />
          ) : (
            <Plus size={17} color={colors.pageBg} />
          )}
        </SemiPillButton>
      )}
    </View>
  );
}

export function PluginList({ props, renderNode }: Render<PluginListProps>) {
  const plugins = Array.isArray(props.plugins) ? props.plugins : [];
  return (
    <View>
      <Header>{props.header}</Header>
      <InsetCard>
        {plugins.map((plugin, i) => (
          <Fragment key={i}>
            {i > 0 ? <RowSeparator /> : null}
            {renderNode(plugin)}
          </Fragment>
        ))}
      </InsetCard>
      {props.footnote ? <RNText style={styles.footnote}>{props.footnote}</RNText> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Comparison & detail
// ---------------------------------------------------------------------------

export function Column({ props }: Render<ColumnProps>) {
  const onPress = useSend(props.send);
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const body = (
    <>
      <View style={styles.columnHead}>
        <RNText style={styles.columnLabel} numberOfLines={1}>
          {props.label}
        </RNText>
      </View>
      {props.badge ? (
        <View style={styles.columnBadge}>
          <RNText style={styles.columnBadgeText}>{props.badge}</RNText>
        </View>
      ) : null}
      {rows.map((row, i) => (
        <View key={i}>
          <RNText style={styles.columnRowLabel}>{row.label}</RNText>
          <RNText style={styles.columnRowValue}>{row.value}</RNText>
        </View>
      ))}
    </>
  );

  // A pickable column bounces; a purely informational one is a plain view, so
  // it doesn't advertise a tap that does nothing.
  if (!onPress) {
    return <View style={styles.columnCard}>{body}</View>;
  }
  return (
    <BouncyPressable onPress={onPress} accessibilityLabel={props.label} style={styles.columnCard}>
      {body}
    </BouncyPressable>
  );
}

export function Compare({ props, renderNode }: Render<CompareProps>) {
  const columns = Array.isArray(props.columns) ? props.columns.slice(0, 3) : [];
  return (
    <View>
      <Header>{props.header}</Header>
      <View style={styles.compareRow}>
        {columns.map((col, i) => (
          <View key={i} style={styles.flex1}>
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
            <View style={styles.kvRow}>
              <RNText style={styles.meta}>{row.label}</RNText>
              <RNText style={styles.kvValue}>{row.value}</RNText>
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
      <View style={styles.stack}>
        {steps.map((step, i) => {
          const done = current > i;
          const active = current === i;
          return (
            <View key={i} style={styles.stepRow}>
              <View
                style={[
                  styles.stepCircle,
                  {
                    backgroundColor: done ? colors.primary : 'transparent',
                    borderWidth: done ? 0 : active ? 2 : 1,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                {done ? (
                  <Check size={12} color={colors.primaryForeground} />
                ) : (
                  <RNText
                    style={[
                      styles.stepNumber,
                      { color: active ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {i + 1}
                  </RNText>
                )}
              </View>
              <View style={styles.flex1}>
                <View style={styles.stepTitleRow}>
                  <RNText
                    style={[
                      styles.stepTitle,
                      active && styles.stepTitleActive,
                      done && styles.stepTitleDone,
                    ]}
                  >
                    {step.title}
                  </RNText>
                  {step.meta ? <RNText style={styles.meta12}>{step.meta}</RNText> : null}
                </View>
                {step.detail ? (
                  <RNText style={styles.subtitle}>{step.detail}</RNText>
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
      style={styles.chip}
    >
      <RNText style={styles.chipText}>{label}</RNText>
    </BouncyPressable>
  );
}

export function Chips({ props }: Render<{ labels?: string[] }>) {
  const labels = Array.isArray(props.labels) ? props.labels : [];
  return (
    <View style={styles.wrapRow}>
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
      style={[
        styles.actionBtn,
        {
          borderColor: danger ? `${colors.destructive}80` : primary ? colors.primary : colors.border,
          backgroundColor: danger
            ? `${colors.destructive}1a`
            : primary
              ? colors.primary
              : colors.surfaceAlt,
          opacity: dimmed ? 0.45 : 1,
        },
      ]}
    >
      <RNText
        style={[
          styles.actionText,
          {
            color: danger
              ? colors.destructive
              : primary
                ? colors.primaryForeground
                : colors.foreground,
          },
        ]}
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
    <View style={[styles.actions, column ? styles.actionsColumn : styles.actionsRow]}>
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
  AudioItem,
  AudioList,
  Recommendation,
  Plugin,
  PluginList,
  Column,
  Compare,
  KeyValue,
  Steps,
  Chips,
  Action,
  Actions,
} as unknown as StudioRenderers;

const styles = StyleSheet.create((theme) => ({
  // Shared bits
  flex1: { flex: 1 },
  stack: { gap: 12 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  header: {
    paddingHorizontal: 4,
    paddingBottom: 6,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
  insetCard: {
    overflow: 'hidden',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  rowSeparator: { marginLeft: 16, height: 1, backgroundColor: theme.colors.border },
  footerCta: { marginTop: 12 },
  footnote: { paddingHorizontal: 4, paddingTop: 6, fontSize: 13, color: theme.colors.mutedForeground },
  // Pick controls
  checkSquare: {
    height: 20,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    borderWidth: 1,
  },
  radio: {
    height: 20,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 2,
  },
  radioDot: { height: 10, width: 10, borderRadius: 999 },
  // Framing
  card: { width: '100%', gap: 12, alignSelf: 'stretch' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  sectionSubtitle: { marginTop: 2, fontSize: 13, color: theme.colors.mutedForeground },
  divider: { height: 1, backgroundColor: theme.colors.border },
  textBody: { fontSize: 15, lineHeight: 21, color: theme.colors.foreground },
  textMuted: { fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  textStrong: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  textTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.foreground },
  callout: { gap: 4, borderRadius: 0, borderWidth: 1, padding: 12 },
  calloutTitle: { fontSize: 15, fontWeight: '500', color: theme.colors.foreground },
  // Rows (Option / AudioItem share the shell)
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '500', color: theme.colors.foreground },
  rowTitleDanger: { color: theme.colors.destructive },
  badge: {
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '500', color: theme.colors.mutedForeground },
  subtitle: { marginTop: 2, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  subtitleNoMargin: { fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  meta: { fontSize: 13, color: theme.colors.mutedForeground },
  meta12: { fontSize: 12, color: theme.colors.mutedForeground },
  // Media
  mediaItem: { gap: 6 },
  mediaFrame: { overflow: 'hidden', borderRadius: 0, borderWidth: 2 },
  mediaCheckPip: { position: 'absolute', left: 6, top: 6, borderRadius: 999, padding: 4 },
  mediaLabel: { paddingHorizontal: 4, fontSize: 13, fontWeight: '500', color: theme.colors.foreground },
  mediaCaption: {
    paddingHorizontal: 4,
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.mutedForeground,
  },
  useBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 0,
    borderWidth: 1,
    paddingVertical: 8,
  },
  useBtnIdle: { borderColor: theme.colors.border, backgroundColor: theme.colors.secondary },
  useBtnChecked: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  useBtnSingle: {
    alignItems: 'center',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.secondary,
    paddingVertical: 8,
  },
  smallBtnText: { fontSize: 13, fontWeight: '500', color: theme.colors.foreground },
  smallBtnTextChecked: { color: theme.colors.primaryForeground },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  // Audio
  playCircle: {
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  pickTap: { paddingVertical: 4, paddingLeft: 4 },
  usePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  // Recommendation
  recBody: { gap: 12, padding: 16 },
  recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: theme.colors.foreground },
  tintBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: `${theme.colors.primary}1f`,
  },
  tintBadgeText: { fontSize: 11, fontWeight: '500', color: theme.colors.primary },
  recBodyText: { marginTop: 4, fontSize: 14, lineHeight: 20, color: theme.colors.mutedForeground },
  bullets: { gap: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  recCta: { marginTop: 2 },
  // Plugins — the marketplace row: icon square, name + tagline, install slab.
  pluginBody: { gap: 12, padding: 16 },
  pluginHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pluginIcon: {
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    borderWidth: 1,
    backgroundColor: theme.colors.secondary,
  },
  pluginCategory: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
  pluginName: { flex: 1, fontSize: 16, fontWeight: '600', color: theme.colors.foreground },
  // Comparison & detail
  columnCard: {
    flex: 1,
    gap: 6,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  columnLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.colors.foreground },
  columnBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: `${theme.colors.primary}1f`,
  },
  columnBadgeText: { fontSize: 10, fontWeight: '500', color: theme.colors.primary },
  columnRowLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
  columnRowValue: { fontSize: 13, color: theme.colors.foreground },
  compareRow: { flexDirection: 'row', gap: 8 },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  kvValue: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '500', color: theme.colors.foreground },
  // Steps
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepCircle: { height: 24, width: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  stepNumber: { fontSize: 11, fontWeight: '600' },
  stepTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  stepTitle: { flex: 1, fontSize: 15, fontWeight: '500', color: theme.colors.foreground },
  stepTitleActive: { fontWeight: '600' },
  stepTitleDone: { color: theme.colors.mutedForeground },
  // Buttons
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, fontWeight: '500', color: theme.colors.foreground },
  actionBtn: { borderRadius: 0, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  actionText: { fontSize: 15, fontWeight: '500' },
  actions: { gap: 8 },
  actionsColumn: { flexDirection: 'column', alignItems: 'stretch' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap' },
}));
