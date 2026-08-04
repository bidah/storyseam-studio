// Inspector — the per-clip editor sheet. On the web these controls live in the
// Editor's right rail / the card context menu; on mobile they are presented in a
// native iOS page-sheet built from REAL SwiftUI controls via `@expo/ui`
// (Host + Slider + Switch + Button). It exposes exactly the web card's actions:
// disable/enable, detach audio, link/unlink, remove — plus volume + fade sliders.
// Web reference: /docs/modules/timeline ↔ this: /docs/react-native/timeline
import { memo } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Host, Slider, Switch, Button } from "@expo/ui";
import { SymbolView } from "expo-symbols";
import { framesToSec, secToFrames, type TimelineItem } from "@/editor/core/timeline";
import { EditorTheme } from "@/editor/theme";

export interface InspectorProps {
  visible: boolean;
  item: TimelineItem | null;
  isAudioTrack: boolean;
  fps: number;
  /** True when >1 clip is selected — enables Link. */
  canLink: boolean;
  onClose: () => void;
  onSetVolume: (id: string, volume: number) => void;
  onSetFade: (id: string, which: "in" | "out", frames: number) => void;
  onToggleDisable: (id: string) => void;
  onToggleMute: (id: string) => void;
  onDetachAudio: (id: string) => void;
  onLinkSelected: () => void;
  onUnlink: (id: string) => void;
  onRemove: (id: string) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function InspectorImpl({
  visible,
  item,
  isAudioTrack,
  fps,
  canLink,
  onClose,
  onSetVolume,
  onSetFade,
  onToggleDisable,
  onToggleMute,
  onDetachAudio,
  onLinkSelected,
  onUnlink,
  onRemove,
}: InspectorProps) {
  const dur = item ? framesToSec(item.durationInFrames, fps) : 0;
  const maxFade = Math.max(0.1, dur / 2);

  return (
    <Modal
      visible={visible && !!item}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>
            {item?.name || "Clip"}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <SymbolView name="xmark" size={16} tintColor={EditorTheme.text} />
          </Pressable>
        </View>

        {item && (
          <ScrollView contentContainerStyle={styles.body}>
            <Field label={`Volume — ${Math.round((item.volume ?? 1) * 100)}%`}>
              {/* A slider has no intrinsic width — matchContents collapses it
                  to zero, so the host must take an explicit height + stretch. */}
              <Host style={styles.sliderHost}>
                <Slider
                  value={item.volume ?? 1}
                  min={0}
                  max={1}
                  onValueChange={(v) => onSetVolume(item.id, v)}
                />
              </Host>
            </Field>

            {isAudioTrack && (
              <>
                <Field label={`Fade in — ${framesToSec(item.fadeInFrames || 0, fps).toFixed(1)}s`}>
                  <Host style={styles.sliderHost}>
                    <Slider
                      value={framesToSec(item.fadeInFrames || 0, fps)}
                      min={0}
                      max={maxFade}
                      onValueChange={(s) => onSetFade(item.id, "in", secToFrames(s, fps))}
                    />
                  </Host>
                </Field>
                <Field label={`Fade out — ${framesToSec(item.fadeOutFrames || 0, fps).toFixed(1)}s`}>
                  <Host style={styles.sliderHost}>
                    <Slider
                      value={framesToSec(item.fadeOutFrames || 0, fps)}
                      min={0}
                      max={maxFade}
                      onValueChange={(s) => onSetFade(item.id, "out", secToFrames(s, fps))}
                    />
                  </Host>
                </Field>
              </>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Muted</Text>
              <Host matchContents>
                <Switch value={!!item.muted} onValueChange={() => onToggleMute(item.id)} />
              </Host>
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Disabled</Text>
              <Host matchContents>
                <Switch value={!!item.disabled} onValueChange={() => onToggleDisable(item.id)} />
              </Host>
            </View>

            <View style={styles.actions}>
              {/* Labels go through the `label` prop — a raw string CHILD becomes
                  a Fabric RawText inside the native host and crashes the app
                  ("Text strings must be rendered within a <Text>"). */}
              {!isAudioTrack && !item.linkId && (
                <Host matchContents style={styles.actionHost}>
                  <Button variant="outlined" label="Detach audio" onPress={() => onDetachAudio(item.id)} />
                </Host>
              )}
              {canLink && (
                <Host matchContents style={styles.actionHost}>
                  <Button variant="outlined" label="Link selected" onPress={onLinkSelected} />
                </Host>
              )}
              {item.linkId && (
                <Host matchContents style={styles.actionHost}>
                  <Button variant="outlined" label="Unlink" onPress={() => onUnlink(item.id)} />
                </Host>
              )}
              <Host matchContents style={styles.actionHost}>
                <Button variant="filled" label="Remove clip" onPress={() => onRemove(item.id)} />
              </Host>
            </View>
          </ScrollView>
        )}
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
  title: { color: EditorTheme.text, fontSize: 20, fontWeight: "700", flex: 1, marginRight: 12 },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: EditorTheme.panelRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 18, gap: 8 },
  field: { marginBottom: 16 },
  fieldLabel: { color: EditorTheme.textDim, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  actions: { marginTop: 20, gap: 10 },
  actionHost: { alignSelf: "stretch" },
  sliderHost: { alignSelf: "stretch", height: 32 },
});

export const Inspector = memo(InspectorImpl);
export default Inspector;
