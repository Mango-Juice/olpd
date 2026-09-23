import { useEffect, useState } from "react";

/** Keep the scene, composer and launch button visible while the mobile keyboard is open. */
export function useMobileKeyboardLayout(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    let fullHeight = window.innerHeight;
    const update = () => {
      fullHeight = Math.max(fullHeight, window.innerHeight);
      setOpen(window.innerWidth <= 800 && document.activeElement?.tagName === "TEXTAREA"
        && (viewport?.height ?? window.innerHeight) < fullHeight * 0.78);
    };
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
  }, []);
  return open;
}
