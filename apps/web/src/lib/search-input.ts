import { z } from "zod";
import { pathSchema } from "@agfs/contracts";
const bound = z.coerce
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .optional();
export const searchInputSchema = z
  .object({
    q: z.string().max(200).default(""),
    path: pathSchema.optional(),
    type: z.string().max(255).optional(),
    tag: z.string().max(40).optional(),
    kind: z.enum(["file", "folder"]).optional(),
    minSize: bound,
    maxSize: bound,
    modifiedAfter: bound,
    modifiedBefore: bound,
    cursor: z.string().max(4096).optional(),
    offset: z.coerce.number().int().min(0).max(100000).optional(),
  })
  .refine(
    (v) =>
      v.minSize === undefined ||
      v.maxSize === undefined ||
      v.minSize <= v.maxSize,
    { message: "Minimum size exceeds maximum" },
  )
  .refine(
    (v) =>
      v.modifiedAfter === undefined ||
      v.modifiedBefore === undefined ||
      v.modifiedAfter <= v.modifiedBefore,
    { message: "Start date exceeds end date" },
  );
