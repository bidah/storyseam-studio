// MediaPool — the source-clip browser. React Native port of
// web-editor/src/modules/media/MediaPool.jsx. The web pool is a collapsible left
// rail; on mobile it is a native iOS page-sheet (RN Modal, presentationStyle
// "pageSheet") — the platform-idiomatic way to present a picker — with a grid of
// PoolCards. Tapping a card adds it to the timeline (onAdd).
// Web reference: /docs/modules/media ↔ this: /docs/react-native/media
import { memo } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SymbolView } from "expo-symbols";
import { EditorTheme } from "@/editor/theme";
import { PoolCard } from "./PoolCard";
import type { Pool, PoolItem } from "@/editor/providers/backend/types";

export interface MediaPoolProps {
  visible: boolean;
  pool: Pool | null;
  onClose: () => void;
  onAdd: (item: PoolItem) => void;
  onImport?: () => void;
}

function MediaPoolImpl({ visible, pool, onClose, onAdd, onImport }: MediaPoolProps) {
  const video = pool?.video || [];
  const audio = pool?.audio || [];
  const add = (item: PoolItem) => {
    onAdd(item);
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Add media</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <SymbolView name="xmark" size={16} tintColor={EditorTheme.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.section}>Video</Text>
          <View style={styles.grid}>
            {video.map((item) => (
              <PoolCard key={item.id} item={item} onAdd={add} />
            ))}
          </View>
          <Text style={styles.section}>Audio</Text>
          <View style={styles.grid}>
            {audio.map((item) => (
              <PoolCard key={item.id} item={item} onAdd={add} />
            ))}
          </View>
          {onImport && (
            <Pressable style={styles.import} onPress={onImport}>
              <SymbolView name="square.and.arrow.down" size={18} tintColor={EditorTheme.accent} />
              <Text style={styles.importText}>Import from device…</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: EditorTheme.panel },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: EditorTheme.border,
  },
  title: { color: EditorTheme.text, fontSize: 20, fontWeight: "700" },
  close: {
    width: 30,
    height: 30,
    borderRadius: 0,
    backgroundColor: EditorTheme.panelRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 18 },
  section: {
    color: EditorTheme.textDim,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 8 },
  import: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 0,
    backgroundColor: EditorTheme.panelRaised,
    marginTop: 8,
  },
  importText: { color: EditorTheme.accent, fontSize: 15, fontWeight: "600" },
});

export const MediaPool = memo(MediaPoolImpl);
export default MediaPool;
