import { ROOMS } from "./content";
import type { Room, RunState } from "./types";

/** The original eight-room route remains playable for existing saved runs. */
export const LEGACY_ROOMS: readonly Room[] = [
  { name: "첫 번째 기억", subtitle: "익숙한 구덩이 앞에서", points: ["pit"] },
  { name: "끊어진 약속", subtitle: "모습이 달라도, 같은 기억", points: ["bridge"] },
  { name: "발밑의 반짝임", subtitle: "조금 더 넓은 가르침", points: ["floorSpikes"] },
  { name: "고개를 낮추면", subtitle: "때로는 작아지는 용기", points: ["lowCeiling"] },
  { name: "다른 길의 발견", subtitle: "뛰어넘을 수 없는 순간", points: ["pitCeilingPath"] },
  { name: "작은 지름길", subtitle: "한 번 배운 용기는 남아", points: ["spikesCeilingPath"] },
  { name: "기억을 이어서", subtitle: "도약하고, 몸을 낮추고", points: ["pit", "lowCeiling"] },
  {
    name: "빛이 드는 곳",
    subtitle: "네가 남긴 모든 한 줄",
    points: ["bridge", "floorSpikes", "lowCeiling", "pitCeilingPath", "spikesCeilingPath", "clear"],
  },
];

/** Saves without a layout marker were created with the original eight-room route. */
export function roomsForRun(state: Pick<RunState, "layoutVersion">): readonly Room[] {
  return state.layoutVersion === 2 ? ROOMS : LEGACY_ROOMS;
}
