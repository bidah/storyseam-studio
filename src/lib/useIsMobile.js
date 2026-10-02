import { useEffect, useState } from "react";

// Below Tailwind's `md` breakpoint — the width at which the studio's two-column
// shell (page + 495px chat) stops fitting and the phone layout takes over.
const QUERY = "(max-width: 767px)";

export function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}
