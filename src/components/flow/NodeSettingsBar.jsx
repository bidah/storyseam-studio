// The per-node settings bar under the prompt editor:
//   image:  model · aspect · style preset
//   video:  model · aspect · duration · audio · style preset
// Model catalogs + presets come from the shared flow meta context. Every option
// list is real (Higgsfield ids / project presets), so a node Run gets a valid
// model. text/upload nodes render no settings.
import { Volume2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useFlowMeta } from "./flow-context";
import { ASPECTS, VIDEO_DURATIONS } from "./flow-config";

// Radix Select forbids empty-string item values — sentinels map back to "".
const DEFAULT_MODEL = "__default__";
const NO_PRESET = "__none__";

export default function NodeSettingsBar({ type, settings, onChange, readOnly }) {
  const { imageModels, videoModels, prompts } = useFlowMeta();
  const isVideo = type === "video";
  const models = isVideo ? videoModels : imageModels;
  const patch = (p) => onChange({ ...settings, ...p });

  return (
    <div className="nodrag nowheel flex flex-wrap items-center gap-1.5">
      <MiniSelect
        label={isVideo ? "Seedance" : "Nano Banana Pro"}
        width="w-[132px]"
        value={settings.model || DEFAULT_MODEL}
        onChange={(v) => patch({ model: v === DEFAULT_MODEL ? "" : v })}
        readOnly={readOnly}
        options={[
          { value: DEFAULT_MODEL, label: isVideo ? "Seedance (default)" : "Nano Banana Pro (default)" },
          ...models.filter((m) => m.id).map((m) => ({ value: m.id, label: m.label })),
        ]}
      />
      <MiniSelect
        label="Aspect"
        value={settings.aspectRatio}
        onChange={(v) => patch({ aspectRatio: v })}
        readOnly={readOnly}
        options={ASPECTS.map((a) => ({ value: a, label: a }))}
      />
      {isVideo && (
        <MiniSelect
          label="Duration"
          value={String(settings.duration)}
          onChange={(v) => patch({ duration: Number(v) })}
          readOnly={readOnly}
          options={VIDEO_DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }))}
        />
      )}
      {isVideo && (
        <label
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2 text-xs text-muted-foreground shadow-xs",
            readOnly && "pointer-events-none opacity-60",
          )}
          title="Generate audio with the clip"
        >
          <Volume2 size={13} />
          <span>Audio</span>
          <Checkbox
            checked={!!settings.generateAudio}
            onCheckedChange={(v) => patch({ generateAudio: !!v })}
            disabled={readOnly}
            aria-label="Generate audio"
          />
        </label>
      )}
      <MiniSelect
        label="Style"
        width="w-[120px]"
        value={settings.presetId || NO_PRESET}
        onChange={(v) => patch({ presetId: v === NO_PRESET ? "" : v })}
        readOnly={readOnly}
        options={[
          { value: NO_PRESET, label: "No style" },
          ...prompts.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}

function MiniSelect({ label, value, options, onChange, readOnly, width = "w-auto" }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={readOnly}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-7 gap-1 border-input bg-card px-2 text-xs shadow-xs", width)}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent onWheelCapture={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
