/**
 * "60 sec video tour": a chip over the home headline that opens the
 * StorySeam release video in a large dialog and plays it straight away.
 * The video lives in R2 (shot-studio-uploads, key media/) and is streamed
 * same-origin through the public `/files/<key>` route; it only loads once
 * the dialog opens.
 */
import { useState } from "react";
import { Play, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";

const VIDEO_URL = "/files/media/storyseam-tour-resolve.mp4";
const POSTER_URL = "/files/media/storyseam-tour-resolve-poster.jpg";

export function VideoTour({ className }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "inline-flex items-center gap-2 self-center border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] px-3 py-1.5 text-sm font-medium text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)] " +
          (className || "")
        }
      >
        <Play size={14} className="fill-current" strokeWidth={0} />
        <span>60 sec video tour</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="gap-0 overflow-hidden bg-black p-0 sm:max-w-[min(90vw,calc(85dvh*16/9))]"
        >
          <DialogTitle className="sr-only">StorySeam video tour</DialogTitle>
          {open && (
            <video
              src={VIDEO_URL}
              poster={POSTER_URL}
              className="block aspect-video w-full bg-black"
              controls
              autoPlay
              playsInline
            />
          )}
          <DialogClose className="absolute top-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white">
            <X size={20} />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}
