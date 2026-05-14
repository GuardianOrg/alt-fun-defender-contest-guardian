/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID: string;
  readonly VITE_RPC_URL: string;
  readonly VITE_PONDER_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_GEO_COUNTRY_OVERRIDE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
