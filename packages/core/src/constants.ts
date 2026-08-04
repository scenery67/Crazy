/**
 * 튜닝 상수. 시간 단위는 전부 "틱"이다 (60틱 = 1초).
 */

export const TICK_RATE = 60;

/** 1 타일의 sub-unit 크기. 모든 좌표는 이 단위의 정수다 */
export const TILE = 1000;

export const MAP_WIDTH = 15;
export const MAP_HEIGHT = 13;

/** speedLevel 인덱스별 이동 속도 (units per tick) — 2.4 ~ 4.2 타일/초 */
export const SPEED_TABLE: readonly number[] = [40, 46, 52, 58, 64, 70];
export const MAX_SPEED_LEVEL = SPEED_TABLE.length - 1;

/**
 * 타일보다 작게 잡아야 조작감이 산다. 다만 너무 작으면 그림이 벽에 파묻힌다.
 *
 * 0.6타일(31px)일 때는 캐릭터 그림(64px)이 벽 안으로 16px씩 들어갔다 — 타일의 31%다.
 * 참고 프로젝트의 "몸통" 크기(42/52 ≈ 0.81타일)에 맞춰 그림 가장자리와 벽이
 * 거의 맞닿게 했다. 물줄기 피격은 중심 타일로 판정하므로 회피 난이도는 그대로다.
 */
export const PLAYER_HITBOX = 800;
/**
 * 코너 어시스트 보정 속도 (units per tick).
 * 진행 방향이 막혔을 때 열린 레인 중심으로 미끄러지는 속도.
 * 걷는 속도보다 약간 빠르게 잡아야 "코너를 돌아 걸어간다"고 느껴진다.
 * 너무 크면 순간이동처럼 보이고, 너무 작으면 벽에 비비는 느낌이 난다.
 */
export const CORNER_ASSIST = 60;

export const BUBBLE_FUSE = 180; // 3.0초
export const WATER_DURATION = 30; // 0.5초
export const TRAP_DURATION = 300; // 5.0초
export const INVULN_DURATION = 60; // 1.0초

/**
 * 갇힌 직후 이 틱 동안은 물줄기가 닿아도 구출되지 않는다.
 *
 * 물줄기는 WATER_DURATION 동안 남아 있으므로, 이 유예가 없으면
 * "나를 가둔 바로 그 물줄기"가 다음 틱에 나를 곧바로 풀어준다.
 * WATER_DURATION만큼 기다리면 그 물줄기는 반드시 사라져 있다.
 */
export const RESCUE_GRACE = WATER_DURATION;

export const SUDDEN_DEATH_AT = TICK_RATE * 180; // 3분
/** 서든데스 진입 후 블록이 하나씩 떨어지는 간격 */
export const SUDDEN_DEATH_INTERVAL = 20;

export const MAX_BUBBLE_CAPACITY = 8;
export const MAX_POWER = 8;

/** Soft 블록 파괴 시 아이템이 나올 확률 (퍼센트) */
export const ITEM_DROP_PERCENT = 30;

/** ItemKind 순서(Bubble, Power, Roller, Needle, Potion, Skull, Shield)의 드랍 가중치 */
export const ITEM_WEIGHTS: readonly number[] = [25, 25, 20, 10, 5, 5, 10];

export const POTION_DURATION = TICK_RATE * 15;
export const SKULL_DURATION = TICK_RATE * 15;
export const SHIELD_DURATION = TICK_RATE * 5;

/** 해골(SlowFeet)에 걸렸을 때의 이동 속도. 기본(40)보다 느리다 */
export const SKULL_SLOW_SPEED = 26;
/** 해골(ForcedPlace)에 걸렸을 때 물풍선을 흘리는 간격 */
export const FORCED_PLACE_INTERVAL = 30;

/** 맵 생성 시 빈 칸이 Soft 블록이 될 확률 (퍼센트) */
export const SOFT_BLOCK_PERCENT = 75;

/** 스폰 지점 주변 이 거리(맨해튼) 이내는 Soft 블록을 놓지 않는다 */
export const SPAWN_SAFE_RADIUS = 2;
