import { z } from "zod";

const finite = z.number().finite().min(-1e12).max(1e12);
const features = z
  .object({
    mean: finite,
    rms: finite.nonnegative(),
    stdDev: finite.nonnegative(),
    peakToPeak: finite.nonnegative(),
    derivativeMean: finite.nonnegative(),
  })
  .strict();
export const contextSchema = z
  .object({
    source: z.enum(["bluetooth", "simulated"]),
    sampleCount: z.number().int().min(0).max(20_000),
    durationMs: z.number().min(0).max(3_600_000),
    score: z.number().min(0).max(100).nullable(),
    status: z.enum(["completed", "interrupted"]),
    quality: z.enum(["good", "limited", "poor"]),
    features,
    baselineFeatures: features,
    baselineSampleCount: z.number().int().min(1).max(20_000),
    temperatureSamples: z.number().int().min(0).max(20_000),
    gsrSamples: z.number().int().min(0).max(20_000),
  })
  .strict();
export const assistantSchema = z
  .object({
    requestId: z.uuid(),
    language: z
      .string()
      .regex(/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/)
      .max(12),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    measurementId: z.uuid().optional(),
    context: contextSchema.optional(),
  })
  .strict()
  .refine(
    (body) => body.messages.at(-1)?.role === "user",
    "The last message must be from the user.",
  )
  .refine(
    (body) =>
      body.messages.reduce(
        (count, message) => count + message.content.length,
        0,
      ) <= 12_000,
    "Conversation is too long.",
  );
export type AssistantInput = z.infer<typeof assistantSchema>;
export type AssistantContext = z.infer<typeof contextSchema>;
