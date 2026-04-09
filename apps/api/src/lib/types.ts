export interface AppBindings {
  DATABASE_URL: string;
  ADMIN_API_KEY: string;
  IMAGES_BUCKET: R2Bucket;
  WEBSOCKET_DO: DurableObjectNamespace;
}
