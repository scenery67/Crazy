import { Dir, ItemKind } from '@crazy/core';

/**
 * 스프라이트 로딩.
 *
 * 이미지는 저장소에 커밋되지 않는다(개인 사용 전용). 따라서 배포본에는
 * 파일이 없고, 그때는 load()가 null을 돌려줘 렌더러가 도형 모드로 되돌아간다.
 * "있으면 쓰고 없으면 만다"가 이 모듈의 유일한 계약이다.
 */

export interface Sheet {
  img: HTMLImageElement;
  /** 가로로 나열된 프레임 수 */
  frames: number;
  /** 프레임 하나의 크기 */
  fw: number;
  fh: number;
}

export interface SpriteSet {
  walk: Record<Dir, Sheet>;
  wait: Sheet;
  trap: Sheet;
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
}

const S = (path: string, frames = 1): Spec => ({ path, frames });

/** 프레임 수는 원본 프로젝트의 imageManager 등록값과 같다 */
const SPECS = {
  walkUp: S('player/bazzi/up.png', 8),
  walkDown: S('player/bazzi/down.png', 8),
  walkLeft: S('player/bazzi/left.png', 6),
  walkRight: S('player/bazzi/right.png', 6),
  wait: S('player/bazzi/wait.png', 3),
  trap: S('player/bazzi/trap.png', 13),
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
} satisfies Record<string, Spec>;

type SpecKey = keyof typeof SPECS;

function loadSheet(base: string, spec: Spec): Promise<Sheet> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        img,
        frames: spec.frames,
        fw: Math.floor(img.naturalWidth / spec.frames),
        fh: img.naturalHeight,
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
    walk: {
      [Dir.Up]: at('walkUp'),
      [Dir.Down]: at('walkDown'),
      [Dir.Left]: at('walkLeft'),
      [Dir.Right]: at('walkRight'),
    },
    wait: at('wait'),
    trap: at('trap'),
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
    },
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
  scale = 1,
): void {
  const i = ((frame % sheet.frames) + sheet.frames) % sheet.frames;
  const w = sheet.fw * scale;
  const h = sheet.fh * scale;
  ctx.drawImage(
    sheet.img,
    i * sheet.fw,
    0,
    sheet.fw,
    sheet.fh,
    Math.round(footX - w / 2),
    Math.round(footY - h),
    w,
    h,
  );
}
