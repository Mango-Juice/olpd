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

/** Retained only to validate/replay events written before the final-room correction. */
export const INTEGRATED_V2_ROOMS: readonly Room[] = [
  { name: "한 걸음의 약속", subtitle: "열린 문까지, 네가 남긴 한 줄로", points: ["clear"] },
  { name: "끊긴 바닥", subtitle: "기억은 남고, 눈앞의 길은 달라져", points: ["pit"] },
  { name: "고개를 낮추면", subtitle: "머리 위도 살펴봐", points: ["lowCeiling"] },
  { name: "발밑의 반짝임", subtitle: "다른 모습에도 통하는 기억", points: ["floorSpikes"] },
  { name: "다른 길의 발견", subtitle: "정면이 막혀도 길은 있어", points: ["pitCeilingPath"] },
  { name: "빛이 드는 곳", subtitle: "두 문턱 너머, 함께 쓴 기억", points: ["bridge", "spikesCeilingPath"] },
];

/** Stored event coordinates are interpreted with the layout that originally wrote them. */
export function roomsForRun(state: Pick<RunState, "layoutVersion">): readonly Room[] {
  if (state.layoutVersion === 3) return ROOMS;
  return state.layoutVersion === 2 ? INTEGRATED_V2_ROOMS : LEGACY_ROOMS;
}

/** v2 saves keep their history coordinates, but no longer execute the removed final tail. */
export function isRetiredChapterTail(state: Pick<RunState, "layoutVersion" | "tutorial" | "room" | "point">): boolean {
  return !state.tutorial && state.layoutVersion === 2 && state.room === 5 && state.point === 1;
}
