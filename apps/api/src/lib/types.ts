export interface AppBindings {
  DATABASE_URL: string;
  ADMIN_API_KEY: string;
  PONDER_URL: string;
  IMAGES_BUCKET: R2Bucket;
  WEBSOCKET_DO: DurableObjectNamespace;
  AI: Ai;
}
