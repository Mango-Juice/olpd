import { afterEach, describe, expect, it, vi } from "vitest";
import { drawDungeonBackdrop } from "../src/render/scene";

type Transform = { a: number; b: number; c: number; d: number; e: number; f: number };
type Calls = { gradients: number; images: number; vines: number; placements?: unknown[][]; transforms?: number[][] };

function fakeContext(transform: Transform, calls: Calls) {
  const methods = {
    getTransform: () => transform,
    createLinearGradient: () => { calls.gradients++; return { addColorStop: () => undefined }; },
    drawImage: (...args: unknown[]) => { calls.images++; calls.placements?.push(args); },
    setTransform: (...args: number[]) => { calls.transforms?.push(args); },
    bezierCurveTo: () => { calls.vines++; },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
  };
  return new Proxy(methods, {
    get(target, key) {
      return key in target ? target[key as keyof typeof target] : () => undefined;
    },
  }) as unknown as CanvasRenderingContext2D;
}

afterEach(() => vi.unstubAllGlobals());

describe("dungeon backdrop raster cache", () => {
  it("reuses static art at native pixel density while drawing moving vines each frame", () => {
    const transform = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const screenCalls = { gradients: 0, images: 0, vines: 0 };
    const rasterCalls = { gradients: 0, images: 0, vines: 0 };
    const screen = fakeContext(transform, screenCalls);
    const raster = fakeContext(transform, rasterCalls);
    const created: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("OffscreenCanvas", class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        created.push(this);
      }
      getContext() { return raster; }
    });

    drawDungeonBackdrop(screen, 0, false);
    drawDungeonBackdrop(screen, 2, false);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ width: 1920, height: 1000 });
    expect(rasterCalls.gradients).toBeGreaterThan(0);
    expect(screenCalls.images).toBe(2);
    expect(screenCalls.vines).toBe(4);

    transform.a = 3;
    transform.d = 3;
    drawDungeonBackdrop(screen, 3, false);
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({ width: 2880, height: 1500 });

    transform.a = 1.37;
    transform.d = 1.37;
    drawDungeonBackdrop(screen, 4, false);
    expect(created[2]).toMatchObject({ width: 1316, height: 685 });
  });

  it("draws directly when the transform cannot preserve sharp pixel alignment", () => {
    const calls = { gradients: 0, images: 0, vines: 0 };
    const transform = { a: 1, b: 0.1, c: 0, d: 1, e: 0.5, f: 0 };
    const screen = fakeContext(transform, calls);
    drawDungeonBackdrop(screen, 0, false);
    expect(calls.gradients).toBeGreaterThan(0);
    expect(calls.images).toBe(0);
    transform.b = 0;
    drawDungeonBackdrop(screen, 1, false);
    expect(calls.images).toBe(0); // Node has no canvas constructor.
  });

  it("preserves fractional device-pixel placement with an unscaled copy", () => {
    const transform = { a: 1.625, b: 0, c: 0, d: 1.625, e: 17.5, f: 9.25 };
    const screenCalls: Calls = { gradients: 0, images: 0, vines: 0, placements: [], transforms: [] };
    const rasterCalls: Calls = { gradients: 0, images: 0, vines: 0, transforms: [] };
    const screen = fakeContext(transform, screenCalls);
    const raster = fakeContext(transform, rasterCalls);
    vi.stubGlobal("OffscreenCanvas", class {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext() { return raster; }
    });

    drawDungeonBackdrop(screen, 0, false);
    expect(rasterCalls.transforms).toContainEqual([1.625, 0, 0, 1.625, 0.5, 0.25]);
    expect(screenCalls.placements?.[0]?.slice(1)).toEqual([17, 9]);
    expect(screenCalls.transforms).toContainEqual([1, 0, 0, 1, 0, 0]);
  });
});
