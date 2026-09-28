import { useCallback, useMemo } from 'react';
import { EnrichedMarkdownText, type MarkdownStyle, type LinkPressEvent } from 'react-native-enriched-markdown';
import remend, { type RemendOptions } from 'remend';
import * as WebBrowser from 'expo-web-browser';
import { useChatColors, type ChatColors } from './theme';

// Markdown rendering via react-native-enriched-markdown (the native renderer
// behind react-native-streamdown), with `remend` closing off partial markdown
// so streaming text never flashes broken syntax. remend runs inline on the JS
// thread — it's a cheap string→string transform for chat-sized messages, and
// <StreamdownText>'s worklet runtime would require Bundle Mode app-wide.
const remendConfig: RemendOptions = {
  bold: true,
  italic: true,
  boldItalic: true,
  strikethrough: true,
  links: true,
  linkMode: 'text-only',
  images: true,
  inlineCode: true,
  katex: false,
  setextHeadings: true,
};

// Scheme-aware style for the native renderer (it can't read NativeWind classes).
function makeBaseStyle(c: ChatColors): MarkdownStyle {
  return {
    paragraph: { color: c.foreground, fontSize: 16, lineHeight: 24, marginTop: 4, marginBottom: 4 },
    h1: { color: c.foreground, fontSize: 22, fontWeight: '700' },
    h2: { color: c.foreground, fontSize: 19, fontWeight: '700' },
    h3: { color: c.foreground, fontSize: 17, fontWeight: '600' },
    h4: { color: c.foreground, fontSize: 16, fontWeight: '600' },
    h5: { color: c.foreground, fontSize: 16, fontWeight: '600' },
    h6: { color: c.foreground, fontSize: 16, fontWeight: '600' },
    list: { color: c.foreground, fontSize: 16, lineHeight: 24, bulletColor: c.mutedForeground, markerColor: c.mutedForeground },
    blockquote: {
      color: c.mutedForeground,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    codeBlock: {
      color: c.foreground,
      fontSize: 13,
      backgroundColor: c.muted,
      borderColor: c.border,
      borderRadius: 0,
      borderWidth: 1,
      padding: 10,
    },
    code: { color: c.foreground, backgroundColor: c.muted, fontSize: 13 },
    link: { color: c.primary, underline: true },
    table: {
      color: c.foreground,
      fontSize: 13,
      headerTextColor: c.foreground,
      headerBackgroundColor: c.muted,
      borderColor: c.border,
      rowEvenBackgroundColor: c.card,
      rowOddBackgroundColor: c.background,
    },
    thematicBreak: { color: c.border, height: 1 },
  };
}

export function ChatMarkdown({
  text,
  streaming = false,
  muted = false,
}: {
  text: string;
  streaming?: boolean;
  muted?: boolean;
}) {
  const c = useChatColors();
  const { baseStyle, mutedStyle } = useMemo(() => {
    const base = makeBaseStyle(c);
    return {
      baseStyle: base,
      mutedStyle: {
        ...base,
        paragraph: { ...base.paragraph, color: c.mutedForeground },
        list: { ...base.list, color: c.mutedForeground },
      } as MarkdownStyle,
    };
  }, [c]);

  const onLinkPress = useCallback((e: LinkPressEvent) => {
    const url = e?.url;
    if (url) WebBrowser.openBrowserAsync(url).catch(() => {});
  }, []);

  if (!text || typeof text !== 'string') return null;

  return (
    <EnrichedMarkdownText
      markdown={streaming ? remend(text, remendConfig) : text}
      markdownStyle={muted ? mutedStyle : baseStyle}
      flavor="github"
      streamingAnimation
      selectable
      onLinkPress={onLinkPress}
    />
  );
}
