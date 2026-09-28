// PoolCard — one draggable source clip in the Media pool. React Native port of
// web-editor/src/modules/media/PoolCard.jsx. The web card is HTML5-draggable
// onto the timeline; on mobile you TAP to add it at the playhead (onAdd),
// matching the platform's tap-first interaction.
// Web reference: /docs/modules/media ↔ this: /docs/react-native/media
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SymbolView } from "expo-symbols";
import { EditorTheme } from "@/editor/theme";
import { colorForSrc } from "./thumbs";
import type { PoolItem } from "@/editor/providers/backend/types";

export interface PoolCardProps {
  item: PoolItem;
  onAdd: (item: PoolItem) => void;
}

function PoolCardImpl({ item, onAdd }: PoolCardProps) {
  const isAudio = item.mediaType === "audio";
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onAdd(item)}
    >
      <View
        style={[
          styles.thumb,
          { backgroundColor: isAudio ? EditorTheme.clipAudio : colorForSrc(item.src) },
        ]}
      >
        <SymbolView
          name={isAudio ? "music.note" : "film.fill"}
          size={22}
          tintColor="rgba(255,255,255,0.9)"
        />
        <View style={styles.addBadge}>
          <SymbolView name="plus" size={12} tintColor="#000" />
        </View>
      </View>
      <Text numberOfLines={1} style={styles.name}>
        {item.name}
      </Text>
      {item.durationSec != null && (
        <Text style={styles.meta}>{item.durationSec.toFixed(0)}s</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: "31%", marginBottom: 14 },
  pressed: { opacity: 0.7 },
  thumb: {
    aspectRatio: 1,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  addBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 0,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { color: EditorTheme.text, fontSize: 12, fontWeight: "600", marginTop: 6 },
  meta: { color: EditorTheme.textDim, fontSize: 11 },
});

export const PoolCard = memo(PoolCardImpl);
export default PoolCard;
