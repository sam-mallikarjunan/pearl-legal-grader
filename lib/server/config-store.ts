import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_RELEASE } from "../catalog";
import {
  canonicalJson,
  validatePublishedConfig,
  type ConfigHistoryEntry,
  type ConfigRelease,
} from "../configuration";
import type { ReleaseSnapshot } from "../types";
import { accountRpc } from "./account-db";

if (typeof window !== "undefined")
  throw new Error("Configuration storage is server-only.");

export class ConfigServiceError extends Error {
  constructor(
    public readonly status = 503,
    public readonly code = "config_unavailable",
    message = "The configuration service is temporarily unavailable. Please try again.",
  ) {
    super(message);
    this.name = "ConfigServiceError";
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const configurationHash = (release: ReleaseSnapshot) =>
  createHash("sha256").update(canonicalJson(release)).digest("hex");
const configured = () =>
  Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
const defaultConfig = (): ConfigRelease => ({
  release: structuredClone(DEFAULT_RELEASE),
  contentHash: configurationHash(DEFAULT_RELEASE),
  publishedAt: null,
  source: "default",
  available: true,
});

function parseConfig(value: unknown): ConfigHistoryEntry {
  if (
    !object(value) ||
    validatePublishedConfig(value.release).length ||
    typeof value.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.contentHash) ||
    typeof value.reason !== "string" ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    (value.publishedAt !== null &&
      (typeof value.publishedAt !== "string" ||
        !Number.isFinite(Date.parse(value.publishedAt))))
  )
    throw new ConfigServiceError();
  const release = value.release as ReleaseSnapshot;
  if (configurationHash(release) !== value.contentHash)
    throw new ConfigServiceError();
  return {
    release,
    contentHash: value.contentHash,
    publishedAt: value.publishedAt as string | null,
    reason: value.reason,
    parentId: value.parentId as string | null,
    source: "published",
    available: true,
  };
}
async function rpc(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    return await accountRpc(name, args);
  } catch {
    throw new ConfigServiceError();
  }
}
export async function getActiveConfig(): Promise<ConfigRelease> {
  if (!configured()) return defaultConfig();
  const active = parseConfig(await rpc("grader_config_read_active"));
  return {
    release: active.release,
    contentHash: active.contentHash,
    publishedAt: active.publishedAt,
    source: active.source,
    available: true,
  };
}
export async function getApprovedConfigRelease(
  releaseId: string,
): Promise<ReleaseSnapshot | null> {
  if (releaseId === DEFAULT_RELEASE.id) return structuredClone(DEFAULT_RELEASE);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(releaseId)) return null;
  if (!configured()) return null;
  const value = await rpc("grader_config_read_release", { p_id: releaseId });
  return value === null ? null : parseConfig(value).release;
}
export async function getConfigHistory(): Promise<{
  active: ConfigRelease;
  history: ConfigHistoryEntry[];
}> {
  const active = await getActiveConfig();
  if (!configured())
    return {
      active,
      history: [
        { ...active, reason: "Initial provisional rubric", parentId: null },
      ],
    };
  const history = await rpc("grader_config_list_releases");
  if (!Array.isArray(history) || history.length > 100)
    throw new ConfigServiceError();
  return { active, history: history.map(parseConfig) };
}
function validateChange(input: {
  expectedActiveId: string;
  reason: string;
  actorId: string;
}) {
  if (
    typeof input.expectedActiveId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.expectedActiveId) ||
    typeof input.reason !== "string" ||
    input.reason.trim().length < 10 ||
    input.reason.trim().length > 500 ||
    typeof input.actorId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.actorId)
  )
    throw new ConfigServiceError(
      400,
      "invalid_config_change",
      "Include the current version and a reason of 10–500 characters.",
    );
}
function changed(value: unknown): ConfigRelease {
  if (object(value) && value.conflict === true)
    throw new ConfigServiceError(
      409,
      "config_conflict",
      "The published version changed. Reload and review your draft against the current version.",
    );
  if (object(value) && value.missing === true)
    throw new ConfigServiceError(
      404,
      "config_missing",
      "That published version is unavailable.",
    );
  const item = parseConfig(value);
  return {
    release: item.release,
    contentHash: item.contentHash,
    publishedAt: item.publishedAt,
    source: "published",
    available: true,
  };
}
export async function publishConfig(input: {
  release: unknown;
  expectedActiveId: string;
  reason: string;
  actorId: string;
}): Promise<ConfigRelease> {
  validateChange(input);
  const errors = validatePublishedConfig(input.release);
  if (errors.length)
    throw new ConfigServiceError(
      400,
      "invalid_configuration",
      errors.slice(0, 8).join(" "),
    );
  const release = structuredClone(input.release as ReleaseSnapshot);
  release.id = `config-${randomUUID()}`;
  return changed(
    await rpc("grader_config_publish", {
      p_snapshot: release,
      p_hash: configurationHash(release),
      p_expected_id: input.expectedActiveId,
      p_reason: input.reason.trim(),
      p_actor: input.actorId,
    }),
  );
}
export async function rollbackConfig(input: {
  releaseId: string;
  expectedActiveId: string;
  reason: string;
  actorId: string;
}): Promise<ConfigRelease> {
  validateChange(input);
  if (
    typeof input.releaseId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.releaseId)
  )
    throw new ConfigServiceError(
      400,
      "invalid_config_change",
      "Choose a published version to restore.",
    );
  return changed(
    await rpc("grader_config_rollback", {
      p_id: input.releaseId,
      p_expected_id: input.expectedActiveId,
      p_reason: input.reason.trim(),
      p_actor: input.actorId,
    }),
  );
}
export function configErrorResponse(error: unknown): Response {
  const known = error instanceof ConfigServiceError;
  return Response.json(
    {
      error: known
        ? error.message
        : "The configuration service is temporarily unavailable.",
      code: known ? error.code : "config_unavailable",
    },
    {
      status: known ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
