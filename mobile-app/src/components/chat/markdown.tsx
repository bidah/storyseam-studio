import { useCallback } from 'react';
import { EnrichedMarkdownText, type MarkdownStyle, type LinkPressEvent } from 'react-native-enriched-markdown';
import remend, { type RemendOptions } from 'remend';
import * as WebBrowser from 'expo-web-browser';
import { chatColors } from './theme';

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

// Dark-theme style for the native renderer (it can't read NativeWind classes).
const baseStyle: MarkdownStyle = {
  paragraph: { color: chatColors.foreground, fontSize: 16, lineHeight: 24, marginTop: 4, marginBottom: 4 },
  h1: { color: chatColors.foreground, fontSize: 22, fontWeight: '700' },
  h2: { color: chatColors.foreground, fontSize: 19, fontWeight: '700' },
  h3: { color: chatColors.foreground, fontSize: 17, fontWeight: '600' },
  h4: { color: chatColors.foreground, fontSize: 16, fontWeight: '600' },
  h5: { color: chatColors.foreground, fontSize: 16, fontWeight: '600' },
  h6: { color: chatColors.foreground, fontSize: 16, fontWeight: '600' },
  list: { color: chatColors.foreground, fontSize: 16, lineHeight: 24, bulletColor: chatColors.mutedForeground, markerColor: chatColors.mutedForeground },
  blockquote: {
    color: chatColors.mutedForeground,
    borderColor: chatColors.border,
    backgroundColor: chatColors.card,
  },
  codeBlock: {
    color: chatColors.foreground,
    fontSize: 13,
    backgroundColor: chatColors.muted,
    borderColor: chatColors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  code: { color: chatColors.foreground, backgroundColor: chatColors.muted, fontSize: 13 },
  link: { color: chatColors.primary, underline: true },
  table: {
    color: chatColors.foreground,
    fontSize: 13,
    headerTextColor: chatColors.foreground,
    headerBackgroundColor: chatColors.muted,
    borderColor: chatColors.border,
    rowEvenBackgroundColor: chatColors.card,
    rowOddBackgroundColor: chatColors.background,
  },
  thematicBreak: { color: chatColors.border, height: 1 },
};

const mutedStyle: MarkdownStyle = {
  ...baseStyle,
  paragraph: { ...baseStyle.paragraph, color: chatColors.mutedForeground },
  list: { ...baseStyle.list, color: chatColors.mutedForeground },
};

export function ChatMarkdown({
  text,
  streaming = false,
  muted = false,
}: {
  text: string;
  streaming?: boolean;
  muted?: boolean;
}) {
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
