import { useCallback } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const faviconFor = (domain) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

// A pasted link, unfurled. The preview is fetched ONCE server-side and stored on
// the card as an op, so `previewData === undefined` means "still unfurling"
// (skeleton) while `null` means the unfurl failed and the card renders bare.
export default function LinkCardNode({ data, selected }) {
  const { url, previewData, onDelete } = data;
  const loading = previewData === undefined;
  const domain = getDomain(url);
  const favicon = previewData?.favicon || faviconFor(domain);

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete],
  );

  const handleOpen = useCallback(
    (e) => {
      e.stopPropagation();
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [url],
  );

  const siteName = previewData?.siteName || domain;
  const { title, description, image } = previewData || {};

  return (
    <div className={`link-card-node group relative ${selected ? "selected" : ""}`}>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={handleDelete}
        aria-label="Delete link"
        className="nodrag absolute right-2 top-2 z-10 text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        style={{ opacity: selected ? 1 : undefined }}
      >
        <Trash2 size={14} />
      </Button>

      <div className="flex h-full flex-col p-4">
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <img
            src={favicon}
            alt=""
            className="size-4 shrink-0 rounded-sm"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
          <span className="truncate text-xs text-muted-foreground">{siteName}</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {loading ? (
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="mt-1 h-16 w-full rounded-md" />
            </div>
          ) : (
            <>
              {title ? (
                <h3 className="line-clamp-2 shrink-0 text-sm font-semibold leading-snug">{title}</h3>
              ) : (
                <p className="line-clamp-3 shrink-0 break-all text-sm text-foreground">{url}</p>
              )}

              {description && (
                <p className="line-clamp-3 shrink-0 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}

              {image && (
                <div className="mt-1 min-h-0 flex-1 overflow-hidden rounded-md">
                  <img
                    src={image}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <Button size="xs" variant="outline" onClick={handleOpen} className="nodrag shadow-sm">
            Open
            <ExternalLink size={12} />
          </Button>
        </div>
      </div>
    </div>
  );
}
