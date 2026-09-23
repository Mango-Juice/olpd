import { MEMORY_INITIAL_ERASERS, MEMORY_DELETE_PENALTY } from "./memory.js";
import type { Action, Observation, ObservationId, Room } from "./types";
export const GAME_VERSION = "1";
export const DUNGEON_VERSION = "1";
export const RULES_VERSION = "1";
export const CONFIG = {
  initialErasers: MEMORY_INITIAL_ERASERS,
  deletionPenalty: MEMORY_DELETE_PENALTY,
  maxInstructionLength: 80,
  requestTimeoutMs: 15000,
  requestsPerMinute: 30,
} as const;
export const ACTION_LABELS: Record<Action, string> = {
  advance: "전진",
  jump: "점프",
  duck: "숙이기",
  detour: "우회",
};
export const OBSERVATIONS: Record<ObservationId, Observation> = {
  clear: {
    id: "clear",
    label: "평평한 길",
    description: "앞에 평평한 길과 열린 문이 보인다. 장애물이나 샛길은 없다.",
    pit: false,
    floorSpikes: false,
    ceilingSpikes: false,
    sidePath: false,
  },
  pit: {
    id: "pit",
    label: "구덩이",
    description: "앞에 바닥이 끊긴 구덩이가 있다. 천장은 높고 샛길은 없다.",
    pit: true,
    floorSpikes: false,
    ceilingSpikes: false,
    sidePath: false,
  },
  bridge: {
    id: "bridge",
    label: "끊어진 다리",
    description:
      "앞에 다리가 끊어져 아래로 떨어지는 구덩이가 있다. 천장은 높고 샛길은 없다.",
    pit: true,
    floorSpikes: false,
    ceilingSpikes: false,
    sidePath: false,
  },
  floorSpikes: {
    id: "floorSpikes",
    label: "바닥 가시",
    description: "앞에 바닥 가시가 있다. 천장은 높고 샛길은 없다.",
    pit: false,
    floorSpikes: true,
    ceilingSpikes: false,
    sidePath: false,
  },
  lowCeiling: {
    id: "lowCeiling",
    label: "낮은 가시 통로",
    description:
      "앞에 천장 가시가 낮게 내려와 있다. 바닥은 평평하고 샛길은 없다.",
    pit: false,
    floorSpikes: false,
    ceilingSpikes: true,
    sidePath: false,
  },
  pitCeilingPath: {
    id: "pitCeilingPath",
    label: "구덩이와 천장 가시 · 샛길",
    description:
      "앞에 구덩이가 있고 바로 위에는 낮은 천장 가시가 있다. 오른편 표지판이 안전한 샛길을 가리킨다.",
    pit: true,
    floorSpikes: false,
    ceilingSpikes: true,
    sidePath: true,
  },
  spikesCeilingPath: {
    id: "spikesCeilingPath",
    label: "위아래 가시 · 샛길",
    description:
      "앞에 바닥 가시와 낮은 천장 가시가 함께 있다. 오른편 표지판이 안전한 샛길을 가리킨다.",
    pit: false,
    floorSpikes: true,
    ceilingSpikes: true,
    sidePath: true,
  },
};
/** The six connected scenes of a new Chapter 1 run. Tutorial rooms below are save compatibility only. */
export const ROOMS: Room[] = [
  { name: "한 걸음의 약속", subtitle: "열린 문까지, 네가 남긴 한 줄로", points: ["clear"] },
  { name: "끊긴 바닥", subtitle: "기억은 남고, 눈앞의 길은 달라져", points: ["pit"] },
  { name: "고개를 낮추면", subtitle: "머리 위도 살펴봐", points: ["lowCeiling"] },
  { name: "발밑의 반짝임", subtitle: "다른 모습에도 통하는 기억", points: ["floorSpikes"] },
  { name: "다른 길의 발견", subtitle: "정면이 막혀도 길은 있어", points: ["pitCeilingPath"] },
  { name: "빛이 드는 곳", subtitle: "두 문턱 너머, 함께 쓴 기억", points: ["bridge", "spikesCeilingPath"] },
];
export const TUTORIAL_ROOM: Room = {
  name: "작은 시작",
  subtitle: "너의 한 줄을 기다리고 있어",
  points: ["clear", "pit", "bridge"],
};
