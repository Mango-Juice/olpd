import { useEffect, useRef, type ReactNode } from "react";
export default function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <button className="close" onClick={onClose} aria-label="닫기">
        ×
      </button>
      <span className="eyebrow">ONE LINE PER DEATH</span>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
