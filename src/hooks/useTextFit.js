import { useEffect, useRef } from "react";

// Shrink a post-it's font until its body fits the card, then grow it back when
// text is deleted. A sticky is a fixed square, so without this a long note just
// clips — and picking one font size for every note makes short ones look lost.
//
// `enabled = false` (the notepad shape, which uses a fixed smaller size) clears
// the inline font-size so CSS takes over again.
export function useTextFit(containerRef, dependencies = [], enabled = true) {
  const currentSizeRef = useRef(18);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const proseMirror = container.querySelector(".ProseMirror");
    if (!proseMirror) return;

    if (!enabled) {
      proseMirror.style.fontSize = "";
      currentSizeRef.current = 18; // reset so re-enabling starts from the max
      return;
    }

    const parent = container.parentElement;
    if (!parent) return;

    const MAX_FONT_SIZE = 18;
    const MIN_FONT_SIZE = 8;
    const STEP = 0.5;
    const BUFFER = 2;

    const getAvailableHeight = () => {
      const style = window.getComputedStyle(parent);
      return (
        parent.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - BUFFER
      );
    };

    let rafId = null;

    const fitText = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const available = getAvailableHeight();
        const contentHeight = proseMirror.scrollHeight;

        if (contentHeight > available && currentSizeRef.current > MIN_FONT_SIZE) {
          currentSizeRef.current = Math.max(MIN_FONT_SIZE, currentSizeRef.current - STEP);
          proseMirror.style.fontSize = `${currentSizeRef.current}px`;
          fitText();
        } else if (contentHeight <= available && currentSizeRef.current < MAX_FONT_SIZE) {
          // Try one step bigger and keep it only if it still fits — measuring
          // after the write is the only reliable way to know.
          const testSize = Math.min(MAX_FONT_SIZE, currentSizeRef.current + STEP);
          proseMirror.style.fontSize = `${testSize}px`;
          if (proseMirror.scrollHeight <= available) {
            currentSizeRef.current = testSize;
            fitText();
          } else {
            proseMirror.style.fontSize = `${currentSizeRef.current}px`;
          }
        }
      });
    };

    const timeoutId = setTimeout(fitText, 0);

    const mutationObserver = new MutationObserver(fitText);
    mutationObserver.observe(proseMirror, { childList: true, subtree: true, characterData: true });

    const resizeObserver = new ResizeObserver(fitText);
    resizeObserver.observe(parent);

    return () => {
      clearTimeout(timeoutId);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, enabled]);
}
