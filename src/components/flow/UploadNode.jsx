import { memo } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NodePreview, SourceHandle } from "./node-parts";
import { useT } from "@/lib/i18n";

// Upload / source node: SOURCE-ONLY. No model, prompt, settings, or Run — it
// holds an existing generation (drag from the Files panel, or the old moodboard
// sticker) and exposes an output handle whose type mirrors the media kind.
function UploadNode({ data }) {
  const t = useT();
  const { generation, readOnly } = data;
  const isVideo = generation?.kind === "video";
  const hasMedia = !!generation?.url;

  return (
    <>
      <div className="flex w-[300px] flex-col overflow-hidden rounded-none border border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-muted-foreground [&_svg]:size-4"><Upload size={16} /></span>
          <span className="text-sm font-medium">{t("Source media")}</span>
        </div>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted/40">
          <NodePreview generation={generation} emptyLabel={t("Open Files to pick a generation")} />
        </div>
        {!readOnly && (
          <div className="nodrag p-2">
            <Button variant="outline" size="sm" className="w-full" onClick={data.onOpenStack}>
              <FolderOpen size={13} /> {hasMedia ? t("Replace media") : t("Open Files")}
            </Button>
          </div>
        )}
      </div>

      {/* Output type matches the media kind so downstream typing stays correct. */}
      <SourceHandle id={isVideo ? "video-output" : "image-output"} />
    </>
  );
}

export default memo(UploadNode);
