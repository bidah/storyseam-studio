import { memo, useCallback } from "react";
import { Clapperboard } from "lucide-react";
import FlowNodeShell from "./FlowNodeShell";
import { HistoryStrip, NodePreview, RefChips, SourceHandle, TargetHandle } from "./node-parts";
import PromptEditor from "./PromptEditor";
import NodeSettingsBar from "./NodeSettingsBar";
import { modelLabel } from "./model-label";
import { useFlowMeta } from "./flow-context";

function VideoFlowNode({ data }) {
  const { node, status, generation, readOnly } = data;
  const { videoModels } = useFlowMeta();
  const settings = node.settings || {};
  const onPromptChange = useCallback((v) => data.onPatch({ prompt: v }), [data]);
  const onSettingsChange = useCallback((next) => data.onPatch({ settings: next }), [data]);

  return (
    <>
      {/* Inputs: a single start-frame (one-to-one), image references, a text prompt. */}
      <TargetHandle id="start-frame" top="28%" />
      <TargetHandle id="image-input" top="50%" />
      <TargetHandle id="text-input" top="72%" />

      <FlowNodeShell
        title="Video"
        icon={<Clapperboard size={16} />}
        modelName={modelLabel(videoModels, settings.model, "Seedance")}
        status={status}
        preview={<NodePreview generation={generation} />}
        running={status === "queued" || status === "running"}
        onRun={() => data.onRun("this")}
        onRunFromHere={() => data.onRun("from-here")}
        onOpenStack={data.onOpenStack}
        stackCount={(data.generations || []).length}
        readOnly={readOnly}
        history={
          <HistoryStrip
            generations={data.generations || (generation ? [generation] : [])}
            currentGenId={node.currentGenId}
            onPick={data.onPickGeneration}
          />
        }
      >
        <RefChips refs={data.refThumbs} />
        <PromptEditor
          value={node.prompt}
          readOnly={readOnly}
          placeholder="Describe the motion. Wire an image into the frame handle to set the first frame."
          onChange={onPromptChange}
          inheritedText={data.inheritedText}
        />
        <NodeSettingsBar type="video" settings={settings} onChange={onSettingsChange} readOnly={readOnly} />
      </FlowNodeShell>

      {/* Output: video — terminal in v1 (no valid downstream target). */}
      <SourceHandle id="video-output" />
    </>
  );
}

export default memo(VideoFlowNode);
