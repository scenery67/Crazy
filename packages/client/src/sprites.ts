import { Dir, ItemKind } from '@crazy/core';

/**
 * 스프라이트 로딩.
 *
 * 파일을 하나라도 못 불러오면 load()가 null을 돌려주고, 렌더러가 도형 모드로 되돌아간다.
 * "있으면 쓰고 없으면 만다"가 이 모듈의 유일한 계약이다.
 * 덕분에 이미지가 빠져도 게임은 그대로 돌아간다.
 */

export interface Sheet {
  img: HTMLImageElement;
  /** 가로로 나열된 프레임 수 */
  frames: number;
  /** 세로 줄 수. 캐릭터 시트는 줄 하나가 방향 하나다 */
  rows: number;
  /** 프레임 하나의 크기 */
  fw: number;
  fh: number;
  /**
   * 그릴 때 곱할 배율.
   * 출처가 다른 그림은 원래 크기가 제각각이라, 시트마다 배율을 들고 있어야
   * 한 화면에서 어떤 것만 유독 작거나 크게 보이지 않는다.
   */
  scale: number;
}

/**
 * 캐릭터 시트의 세로 줄 순서: 0=왼쪽, 1=위, 2=오른쪽, 3=아래.
 * 원본 프로젝트의 배치이며, 우리 Dir 열거값과 순서가 다르므로 변환이 필요하다.
 */
export const CHAR_ROW: Record<Dir, number> = {
  [Dir.Left]: 0,
  [Dir.Up]: 1,
  [Dir.Right]: 2,
  [Dir.Down]: 3,
};

/**
 * 봇 캐릭터 시트는 프레임이 44x62 / 42x57로, 사용자 캐릭터(64x76)보다 작다.
 * 그대로 두면 같은 판에서 봇만 작아 보이므로 키를 맞춘다.
 */
export const CHAR_SCALE = 1.3;

/**
 * 갇힘·사망 시트에서 이 플레이어가 쓸 줄.
 *
 * 사용자 캐릭터는 sample1의 빨간 배찌 그림을 쓰므로 항상 빨강배찌 줄(0)이다.
 * 봇은 자리 번호가 곧 캐릭터 순서라 그대로 줄 번호가 된다.
 */
export function deathRow(playerId: number, isLocal: boolean): number {
  return isLocal ? 0 : playerId % 4;
}

/** 갇힘 시트는 색 구분이 없어 캐릭터 종류만 고른다 */
export function trapRow(playerId: number, isLocal: boolean): number {
  return deathRow(playerId, isLocal) < 2 ? 0 : 1;
}

export interface SpriteSet {
  /** 사람이 잡는 자리. 방향별로 시트가 따로 있고 크다(64x76) */
  hero: Record<Dir, Sheet>;
  /** 봇 자리. 8열(프레임) x 4행(방향) 한 장짜리 시트 */
  chars: Sheet[];
  /** 갇힘. 줄 하나가 캐릭터 종류(0=배찌 1=디즈니) */
  trap: Sheet;
  /** 사망. 줄 하나가 캐릭터+색(0=빨강배찌 1=파랑배찌 2=빨강디즈니 3=파랑디즈니) */
  die: Sheet;
  shadow: Sheet;
  bomb: Sheet;
  /** 폭발 중심 */
  burst: Sheet;
  /** 물줄기 중간 / 끝 — 원본에서 wave*2 / wave*1에 해당한다 */
  waveArm: Record<Dir, Sheet>;
  waveTip: Record<Dir, Sheet>;
  floor: Sheet;
  hardBlock: Sheet;
  softBlock: Sheet;
  softPop: Sheet;
  /** 대응하는 그림이 없는 아이템은 비어 있고, 렌더러가 도형으로 그린다 */
  items: Partial<Record<ItemKind, Sheet>>;
}

interface Spec {
  path: string;
  frames: number;
  rows: number;
  scale: number;
}

const S = (path: string, frames = 1, rows = 1, scale = 1): Spec => ({ path, frames, rows, scale });

/** 프레임 수는 원본 프로젝트의 imageManager 등록값과 같다 */
const SPECS = {
  heroUp: S('player/bazzi/up.png', 8),
  heroDown: S('player/bazzi/down.png', 8),
  heroLeft: S('player/bazzi/left.png', 6),
  heroRight: S('player/bazzi/right.png', 6),
  // 갇힘·사망은 캐릭터별로 줄이 나뉜 시트를 쓴다.
  // 예전에는 배찌 것 하나로 돌려써서, 파란 캐릭터가 갇히면 빨갛게 변했다
  trap: S('chars/Trapped.png', 16, 2),
  die: S('chars/Die.png', 8, 4),
  shadow: S('player/shadow.png'),
  bomb: S('bomb/1.png', 4),
  burst: S('bomb/pop.png', 6),
  waveArmUp: S('wave/up2.png', 11),
  waveArmDown: S('wave/down2.png', 11),
  waveArmLeft: S('wave/left2.png', 11),
  waveArmRight: S('wave/right2.png', 11),
  waveTipUp: S('wave/up1.png', 11),
  waveTipDown: S('wave/down1.png', 11),
  waveTipLeft: S('wave/left1.png', 11),
  waveTipRight: S('wave/right1.png', 11),
  floor: S('map/forest/tile/tile_1.png'),
  hardBlock: S('map/forest/object/object_1.png'),
  softBlock: S('map/forest/block/block_1.png'),
  softPop: S('map/forest/block/block_1_pop.png', 5),
  itemBubble: S('item/ballon.png', 2),
  itemPower: S('item/potion.png', 2),
  itemRoller: S('item/skate.png', 2),
  itemPotion: S('item/potion_make_power_max.png', 2),
  // 아래 셋은 원본이 작은 단일 프레임이라(누끼 후 23x23 / 24x30 / 24x26)
  // 배율로 키워 세로 약 41px에 맞춘다. 다른 아이템(내용 42x59) 옆에서 혼자 작아 보이면 안 된다
  itemNeedle: S('item/niddle.png', 1, 1, 1.8),
  itemSkull: S('item/skeleton.png', 1, 1, 1.37),
  itemShield: S('item/shield.png', 1, 1, 1.58),
  // 봇 자리마다 다른 캐릭터를 준다. 전원이 같은 모습이면 누가 누군지 알 수 없다
  char0: S('chars/RedBazzi.png', 8, 4),
  char1: S('chars/BlueBazzi.png', 8, 4),
  char2: S('chars/RedDizni.png', 8, 4),
  char3: S('chars/BlueDizni.png', 8, 4),
} satisfies Record<string, Spec>;

type SpecKey = keyof typeof SPECS;

function loadSheet(base: string, spec: Spec): Promise<Sheet> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        img,
        frames: spec.frames,
        rows: spec.rows,
        scale: spec.scale,
        fw: Math.floor(img.naturalWidth / spec.frames),
        fh: Math.floor(img.naturalHeight / spec.rows),
      });
    img.onerror = () => reject(new Error(`스프라이트 없음: ${spec.path}`));
    img.src = base + spec.path;
  });
}

export async function loadSprites(): Promise<SpriteSet | null> {
  const base = `${import.meta.env.BASE_URL}sprites/`;
  const keys = Object.keys(SPECS) as SpecKey[];

  let loaded: Sheet[];
  try {
    loaded = await Promise.all(keys.map((k) => loadSheet(base, SPECS[k])));
  } catch {
    // 하나라도 없으면 통째로 포기한다. 절반만 스프라이트인 화면이 더 나쁘다
    return null;
  }

  const at = (key: SpecKey): Sheet => loaded[keys.indexOf(key)]!;

  return {
    hero: {
      [Dir.Up]: at('heroUp'),
      [Dir.Down]: at('heroDown'),
      [Dir.Left]: at('heroLeft'),
      [Dir.Right]: at('heroRight'),
    },
    trap: at('trap'),
    die: at('die'),
    shadow: at('shadow'),
    bomb: at('bomb'),
    burst: at('burst'),
    waveArm: {
      [Dir.Up]: at('waveArmUp'),
      [Dir.Down]: at('waveArmDown'),
      [Dir.Left]: at('waveArmLeft'),
      [Dir.Right]: at('waveArmRight'),
    },
    waveTip: {
      [Dir.Up]: at('waveTipUp'),
      [Dir.Down]: at('waveTipDown'),
      [Dir.Left]: at('waveTipLeft'),
      [Dir.Right]: at('waveTipRight'),
    },
    floor: at('floor'),
    hardBlock: at('hardBlock'),
    softBlock: at('softBlock'),
    softPop: at('softPop'),
    items: {
      [ItemKind.Bubble]: at('itemBubble'),
      [ItemKind.Power]: at('itemPower'),
      [ItemKind.Roller]: at('itemRoller'),
      [ItemKind.Potion]: at('itemPotion'),
      [ItemKind.Needle]: at('itemNeedle'),
      [ItemKind.Skull]: at('itemSkull'),
      [ItemKind.Shield]: at('itemShield'),
    },
    chars: [at('char0'), at('char1'), at('char2'), at('char3')],
  };
}

/**
 * 시트에서 프레임 하나를 그린다.
 * 위치는 "바닥 중앙" 기준이다 — 스프라이트가 타일보다 크고 위로 넘치는
 * 유사 3D 배치라서, 발밑을 기준으로 잡아야 타일과 어긋나지 않는다.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  frame: number,
  footX: number,
  footY: number,
  row = 0,
  scale = 1,
): void {
  const i = ((frame % sheet.frames) + sheet.frames) % sheet.frames;
  const r = Math.min(Math.max(row, 0), sheet.rows - 1);
  const s = sheet.scale * scale;
  const w = sheet.fw * s;
  const h = sheet.fh * s;
  ctx.drawImage(
    sheet.img,
    i * sheet.fw,
    r * sheet.fh,
    sheet.fw,
    sheet.fh,
    Math.round(footX - w / 2),
    Math.round(footY - h),
    w,
    h,
  );
}
