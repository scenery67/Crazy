/** Vite가 주입하는 값. tsconfig의 types를 비워둬서 직접 선언한다 */
interface ImportMeta {
  readonly env: {
    /** 배포 경로 접두사. GitHub Pages 프로젝트 페이지에서는 "/Crazy/" */
    readonly BASE_URL: string;
    /**
     * 배포된 게임 서버 주소. 빌드 시 주입한다.
     * Pages는 https라서 반드시 wss:// 여야 한다 — ws://는 브라우저가 막는다
     */
    readonly VITE_SERVER_URL?: string;
  };
}
