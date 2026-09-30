export interface Music {
  sampleRate: number;
  duration: number;
  left: Float32Array;
  right: Float32Array;
}
export function renderMusic(): Music;
