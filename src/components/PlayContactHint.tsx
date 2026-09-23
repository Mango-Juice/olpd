/** A short discovery inside the existing feedback, with no extra interaction. */
export function PlayContactHint({ text, className = "" }: { text: string | null; className?: string }) {
  return text ? <span className={`play-contact-hint ${className}`.trim()}>{text}</span> : null;
}
