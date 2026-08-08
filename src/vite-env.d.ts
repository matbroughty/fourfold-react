/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the FourFold API (the Lambda Function URL). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
