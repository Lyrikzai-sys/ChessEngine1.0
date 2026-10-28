/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override where piece models are fetched from. See src/ui/Pieces.tsx. */
  readonly VITE_MODEL_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
