export {};

declare module '*.png' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    localRag?: {
      selectFolder: () => Promise<string | null>;
      selectModelFolder: () => Promise<string | null>;
      selectGgufFiles: () => Promise<string[]>;
      openPath: (filePath: string) => Promise<boolean | string>;
    };
  }
}
