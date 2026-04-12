import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

import formatError from "./format-error.js";

/**
 * Wraps @hono/zod-validator with a consistent error hook that returns
 * the project's standard error envelope (`formatError`).
 */
export function zodValidator<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod v3/v4 type mismatch across hoisted packages
  return zValidator(target, schema as any, (result, c) => {
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join(", ");
      return c.json(formatError(messages), 400);
    }
  });
}
