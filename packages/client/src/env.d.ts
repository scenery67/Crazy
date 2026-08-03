/** Vite가 주입하는 값. tsconfig의 types를 비워둬서 직접 선언한다 */
interface ImportMeta {
  readonly env: {
    /** 배포 경로 접두사. GitHub Pages 프로젝트 페이지에서는 "/Crazy/" */
    readonly BASE_URL: string;
  };
}
