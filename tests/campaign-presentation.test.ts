import { describe, expect, it } from "vitest";
import {
  formatEntityFacts,
  formatMaterial,
  formatProperty,
  formatScalar,
  propertyVisibility,
} from "../src/campaign/presentation";
import { FORGE_STAGE } from "./fixtures/campaign-worlds/forge";
import { GARDEN_PUBLIC_CATALOG, GARDEN_STAGE } from "./fixtures/campaign-worlds/garden";
import { KITCHEN_STAGE } from "./fixtures/campaign-worlds/kitchen";
import { RAIN_STAGE } from "./fixtures/campaign-worlds/rain";
import { STOREHOUSE_PUBLIC_CATALOG, STOREHOUSE_STAGE } from "./fixtures/campaign-worlds/storehouse";
import { THEATRE_PUBLIC_CATALOG, THEATRE_STAGE } from "./fixtures/campaign-worlds/theatre";

const stages = [RAIN_STAGE, KITCHEN_STAGE, FORGE_STAGE];
const laterStages = [GARDEN_STAGE, STOREHOUSE_STAGE];

describe("campaign presentation", () => {
  it("classifies every stage 2-4 initial property instead of leaking an internal key", () => {
    for (const stage of stages) {
      for (const segment of [stage.practice, ...stage.segments]) {
        const world = segment.enter(null);
        for (const entity of Object.values(world.entities)) {
          for (const key of Object.keys(entity.properties)) {
            expect(
              propertyVisibility(key),
              `${stage.id}/${segment.id}/${entity.id}/${key}`,
            ).not.toBe("unknown");
          }
        }
      }
    }
  });

  it("hides bookkeeping but keeps cycle order and the current phase readable", () => {
    const world = KITCHEN_STAGE.practice.enter(null);
    const pendulum = world.entities["practice-pendulum"];

    expect(formatProperty(world, "kind", pendulum.properties.kind)).toBeNull();
    expect(
      formatProperty(world, "periodTicks", pendulum.properties.periodTicks),
    ).toBeNull();
    expect(formatProperty(world, "cycle", pendulum.properties.cycle)).toEqual({
      key: "cycle",
      label: "반복 순서",
      value: "오른쪽 → 가운데 → 왼쪽 → 가운데",
    });
    expect(formatProperty(world, "phase", pendulum.properties.phase)?.value).toBe(
      "오른쪽",
    );
  });

  it("resolves entity relationships and formats physical facts in Korean", () => {
    const world = RAIN_STAGE.segments[0].enter(null);
    const cork = world.entities["rain-cork"];
    const facts = formatEntityFacts(world, cork);

    expect(formatMaterial(cork.material)).toBe("코르크");
    expect(facts).toContain("위치 · 시작점에서 1칸");
    expect(facts).toContain("수용 한계 · 1칸");
    expect(facts).toContain("닿는 거리 · 2칸");
    expect(facts.join(" ")).not.toMatch(/cork|driftAge|kind/);

    const channels = RAIN_STAGE.segments[1].enter(null);
    const linked = Object.values(channels.entities).find(
      (entity) => typeof entity.properties.connectedTo === "string",
    );
    expect(linked).toBeTruthy();
    const target = linked!.properties.connectedTo;
    expect(formatProperty(channels, "connectedTo", target)?.value).toBe(
      channels.entities[String(target)].name,
    );
  });

  it("translates pipe lists, special conditions, and hides unknown keys", () => {
    const forge = FORGE_STAGE.segments[3].enter(null);
    expect(
      formatScalar("upstream-pressure-room|routing-room|bridge-room", forge),
    ).toBe("상류 압력실 → 분기실 → 다리 구역");

    const kitchen = KITCHEN_STAGE.practice.enter(null);
    expect(formatScalar("practice-pendulum:left", kitchen)).toBe(
      "왕복 추이 왼쪽일 때",
    );
    expect(formatProperty(kitchen, "unlistedInternalKey", true)).toBeNull();
  });

  it("classifies every stage 5-6 public catalog and initial property", () => {
    for (const [stage, catalog] of [
      [GARDEN_STAGE, GARDEN_PUBLIC_CATALOG],
      [STOREHOUSE_STAGE, STOREHOUSE_PUBLIC_CATALOG],
    ] as const) {
      for (const segment of [stage.practice, ...stage.segments]) {
        const world = segment.enter(null);
        for (const entity of Object.values(world.entities)) {
          for (const key of Object.keys(entity.properties)) {
            expect(propertyVisibility(key), `${stage.id}/${segment.id}/${entity.id}/${key}`).not.toBe("unknown");
          }
        }
        for (const entity of catalog[segment.id]) {
          for (const key of entity.properties) {
            expect(propertyVisibility(key), `${stage.id}/catalog/${segment.id}/${entity.id}/${key}`).not.toBe("unknown");
          }
        }
      }
    }
  });

  it("keeps stage 5 gravity, room scope, rails, and runtime hazards readable", () => {
    const garden = GARDEN_STAGE.segments[4].enter(null);
    const gravityFacts = formatEntityFacts(garden, garden.entities["05-5-left-room"]);
    const railFacts = formatEntityFacts(garden, garden.entities["05-5-normal-pot"]);

    expect(gravityFacts).toContain("이 방의 중력 방향 · 왼쪽");
    expect(railFacts).toContain("고정 레일 구간 · 해 방 발판 화분 레일");
    expect(formatProperty(garden, "fromRegion", "05-5-central")?.value).toBe("중앙 안전실");
    expect(formatProperty(garden, "selected", "vine")?.value).toBe("덩굴길");
    expect(formatProperty(garden, "passageBlocked", true)?.value).toBe("통로가 막힘");
    expect(formatProperty(garden, "broken", true)?.value).toBe("부서짐");
    expect(formatProperty(garden, "observedLoad", 3)?.value).toBe("3눈금");
    expect(formatProperty(garden, "contact", true)?.value).toBe("위험물에 닿음");
  });

  it("keeps stage 6 inventory, lights, closing beats, and current transport status readable", () => {
    const corridor = STOREHOUSE_STAGE.segments[1].enter(null);
    const final = STOREHOUSE_STAGE.segments[4].enter(null);
    const boardFacts = formatEntityFacts(final, final.entities["06-5-inventory"]);
    const gateFacts = formatEntityFacts(corridor, corridor.entities["06-2-gate-b"]);
    const elevatorFacts = formatEntityFacts(final, final.entities["06-5-elevator"]);
    const letterFacts = formatEntityFacts(final, final.entities.letter);

    expect(boardFacts).toContain("손에 든 물건 · 비어 있음");
    expect(boardFacts).toContain("고리에 건 물건 · 비어 있음");
    expect(gateFacts).toContain("현재 닫힘 박자 · 2박");
    expect(elevatorFacts).toContain("이동 중인 층 · 없음");
    expect(formatProperty(final, "movingTo", "upper")?.value).toBe("위층");
    expect(formatProperty(final, "brakeMark", "upper-locked")?.value).toBe("위층에 브레이크 잠김");
    expect(formatProperty(final, "transportRoute", "cargo-winch")?.value).toBe("화물 손윈치");
    expect(propertyVisibility("darkTicks")).toBe("hidden");
    expect(propertyVisibility("usedWallHook")).toBe("hidden");
    expect(formatProperty(final, "path", "lamp-a>mirror-a>receiver-a|lamp-b>mirror-b>receiver-b")?.value)
      .toBe("첫째 등불 → 첫째 반사경 → 첫째 수광판 → 둘째 등불 → 둘째 반사경 → 둘째 수광판");
    expect(letterFacts).toContain("운반 구분 · 몸에 매단 여정 물품");
    expect(letterFacts).toContain("몸에 매단 물품 · 손·고리와 별도로 몸에 매고 있음");
  });

  it("does not expose stage 5-6 internal ids or enum tokens in shown initial facts", () => {
    for (const stage of laterStages) {
      for (const segment of [stage.practice, ...stage.segments]) {
        const world = segment.enter(null);
        for (const entity of Object.values(world.entities)) {
          for (const fact of formatEntityFacts(world, entity)) {
            expect(fact, `${stage.id}/${segment.id}/${entity.id}`).not.toMatch(/\b(?:0[56]-[\w-]+|[\w-]+-track|room-gravity-marker|rail-pot)\b/);
          }
        }
      }
    }
  });

  it("classifies the current stage 7 public catalog and preserves role states in Korean", () => {
    for (const segment of [THEATRE_STAGE.practice, ...THEATRE_STAGE.segments]) {
      const world = segment.enter(null);
      for (const entity of Object.values(world.entities)) {
        for (const key of Object.keys(entity.properties)) {
          expect(propertyVisibility(key), `7/${segment.id}/${entity.id}/${key}`).not.toBe("unknown");
        }
      }
      for (const entity of THEATRE_PUBLIC_CATALOG[segment.id]) {
        for (const key of entity.properties) {
          expect(propertyVisibility(key), `7/catalog/${segment.id}/${entity.id}/${key}`).not.toBe("unknown");
        }
      }
    }

    const opening = THEATRE_STAGE.segments[0].enter(null);
    expect(formatProperty(opening, "heldBy", "keeper")?.value).toBe("등지기");
    expect(formatProperty(opening, "closingBeatsRemaining", 2)?.value).toBe("2박");
    expect(formatProperty(opening, "causalTarget", "07-1-curtain.open")?.value)
      .toBe("세 박자 무대막의 열림");
    expect(formatProperty(opening, "support", "hand:keeper")?.value).toBe("등지기의 손");
  });
});
