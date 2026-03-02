import * as fs from "fs";
import { z } from "zod";

// Basic auth config shape
const BasicAuthSchema = z
  .object({
    url: z.string().url("'url' must be a valid URL"),
    username: z.string().min(1, "'username' must not be empty"),
    password: z.string().min(1, "'password' must not be empty"),
    insecure: z.boolean().optional(),
  })
  .strict(); // .strict() rejects unknown fields (FOUND-05)

// Token auth config shape
const TokenAuthSchema = z
  .object({
    url: z.string().url("'url' must be a valid URL"),
    token: z.string().min(1, "'token' must not be empty"),
    insecure: z.boolean().optional(),
  })
  .strict();

// Union: TokenAuthSchema first — prevents strict() on BasicAuth from rejecting "token" as unknown
const ConfigSchema = z.union([TokenAuthSchema, BasicAuthSchema]);

export type OpenNMSConfig = z.infer<typeof ConfigSchema>;

export function isTokenAuth(
  config: OpenNMSConfig
): config is z.infer<typeof TokenAuthSchema> {
  return "token" in config;
}

export function loadConfig(filePath: string): OpenNMSConfig {
  // Check file exists (FOUND-05: missing file)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  // Parse JSON (FOUND-05: malformed JSON)
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Config file is not valid JSON: ${filePath}\n${String(err)}`
    );
  }

  // Validate shape (FOUND-05: invalid fields; .strict() catches unknown fields)
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config file validation failed:\n${issues}`);
  }

  // Strip trailing slash from URL (prevents double-slash in API paths)
  const parsed = result.data;
  parsed.url = parsed.url.replace(/\/$/, "");
  return parsed;
}
