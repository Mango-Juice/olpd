import { renderMusic } from "./music.js";

// 합성에 1초쯤 걸리므로 화면이 멈추지 않게 워커에서 계산해 넘긴다.
const music = renderMusic();
(self as unknown as Worker).postMessage(music, [music.left.buffer, music.right.buffer]);
