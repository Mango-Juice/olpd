export const DUR: number;
export function loadSprite(url: string): Promise<void>;
export function warmFonts(): Promise<void>;
export function renderAt(context: CanvasRenderingContext2D, time: number, scale?: number): void;
