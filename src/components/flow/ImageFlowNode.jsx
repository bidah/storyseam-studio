import { memo, useCallback } from "react";
import { Image as ImageIcon } from "lucide-react";
import FlowNodeShell from "./FlowNodeShell";
import { HistoryStrip, NodePreview, RefChips, SourceHandle, TargetHandle } from "./node-parts";
import PromptEditor from "./PromptEditor";
import NodeSettingsBar from "./NodeSettingsBar";
import { modelLabel } from "./model-label";
import { useFlowMeta } from "./flow-context";

function ImageFlowNode({ data }) {
  const { node, status, generation, readOnly } = data;
  const { imageModels } = useFlowMeta();
  const settings = node.settings || {};
  const onPromptChange = useCallback((v) => data.onPatch({ prompt: v }), [data]);
  const onSettingsChange = useCallback((next) => data.onPatch({ settings: next }), [data]);

  return (
    <>
      {/* Inputs: many reference images (one-to-many) + a text prompt source. */}
      <TargetHandle id="image-input" top="38%" />
      <TargetHandle id="text-input" top="62%" />

      <FlowNodeShell
        title="Image"
        icon={<ImageIcon size={16} />}
        modelName={modelLabel(imageModels, settings.model, "Nano Banana Pro")}
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
          placeholder="Describe the image. Wire images into the blue handle to use them as references."
          onChange={onPromptChange}
          inheritedText={data.inheritedText}
        />
        <NodeSettingsBar type="image" settings={settings} onChange={onSettingsChange} readOnly={readOnly} />
      </FlowNodeShell>

      {/* Output: image, fans out to image-input / start-frame. */}
      <SourceHandle id="image-output" />
    </>
  );
}

export default memo(ImageFlowNode);
