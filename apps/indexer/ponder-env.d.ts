import type { Virtual } from "@ponder/core";
import type config from "./ponder.config";
import type * as schema from "./ponder.schema";

declare module "@/generated" {
  const ponder: Virtual.Registry<typeof config, typeof schema>;
  export { ponder };
}
