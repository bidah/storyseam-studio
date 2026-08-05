import { memo, useCallback } from "react";
import { Type, Play } from "lucide-react";
import { SourceHandle } from "./node-parts";
import PromptEditor from "./PromptEditor";
import { useT } from "@/lib/i18n";

// Text node: a pure prompt SOURCE. No model / preview / settings — its
// text-output fans into downstream text-input handles. Its only action is "Run
// from here", which regenerates everything downstream with this prompt inherited.
function TextNode({ data }) {
  const t = useT();
  const { node, readOnly } = data;
  const onPromptChange = useCallback((v) => data.onPatch({ prompt: v }), [data]);

  return (
    <>
      <div className="flex w-[280px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-md">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-muted-foreground [&_svg]:size-4"><Type size={16} /></span>
          <span className="text-sm font-medium">{t("Text")}</span>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <PromptEditor
            value={node.prompt}
            readOnly={readOnly}
            placeholder={t("Write a prompt to feed downstream nodes…")}
            onChange={onPromptChange}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => data.onRun("from-here")}
              className="nodrag self-end inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
              title={t("Regenerate every node downstream of this one")}
            >
              <Play size={13} /> {t("Run from here")}
            </button>
          )}
        </div>
      </div>

      {/* Output: text, fans out to many text-input handles. */}
      <SourceHandle id="text-output" />
    </>
  );
}

export default memo(TextNode);
