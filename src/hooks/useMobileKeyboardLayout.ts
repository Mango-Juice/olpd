import { useEffect, useRef, useState } from "react";

/** Keep the scene, composer and launch button visible while the mobile keyboard is open. */
export function useMobileKeyboardLayout(hasDraft: boolean): boolean {
  const [open, setOpen] = useState(false);
  // Browser dimensions are sampled by update() in the effect, never during SSR.
  const fullHeight = useRef(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      fullHeight.current = Math.max(fullHeight.current, window.innerHeight);
      const keyboardVisible = document.activeElement?.matches("textarea[data-play-command]")
        && (viewport?.height ?? window.innerHeight) < fullHeight.current * 0.78;
      // iOS can blur before delivering click. Keep the target stable through
      // keyboard dismissal and failed requests until the draft is consumed/cleared.
      setOpen((wasOpen) => window.innerWidth <= 800
        && (!!keyboardVisible || (wasOpen && hasDraft)));
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, [hasDraft]);
  return open;
}
