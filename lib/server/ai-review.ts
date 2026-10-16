import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, jsonSchema, Output } from "ai";
import {
  AI_REVIEW_MAX_OUTPUT_TOKENS,
  AI_REVIEW_MODEL,
  AI_REVIEW_OUTPUT_SCHEMA,
  AI_REVIEW_PROMPT_VERSION,
  AI_REVIEW_SCHEMA_VERSION,
  AI_REVIEW_SYSTEM_PROMPT,
  AI_REVIEW_TIMEOUT_MS,
  aiReviewPrompt,
  buildAIReviewSources,
  isWebsiteAIReview,
  validateAIReviewOutput,
  type AIReviewAvailability,
  type AIReviewOutput,
  type AIReviewSource,
  type WebsiteAIReview,
} from "../ai-review";
import { accountRpc } from "./account-db";
import { readAccountReport } from "./account-store";
import {
  accountRecord,
  accountUuid,
  canonicalJson,
} from "../account/validation";
import type { CloudReport } from "../account/types";

if (typeof window !== "undefined")
  throw new Error("AI provider access belongs on the server.");

export class AIReviewError extends Error {
  constructor(
    public code = "ai_unavailable",
    message = "The website explanation could not be prepared. Your scores and saved report are unchanged.",
    public status = 503,
  ) {
    super(message);
    this.name = "AIReviewError";
  }
}
export function aiReviewConfigured(): boolean {
  return (
    process.env.AI_REVIEW_ENABLED === "true" && !!process.env.OPENAI_API_KEY
  );
}

interface GeneratedExplanation {
  output: unknown;
  providerModel: string;
}
interface Dependencies {
  configured: () => boolean;
  readReport: typeof readAccountReport;
  rpc: typeof accountRpc;
  generate: (sources: AIReviewSource[]) => Promise<GeneratedExplanation>;
  now: () => Date;
}

/** Intentional direct OpenAI account use. No Gateway fallback or third-party routing. */
export async function generateWebsiteExplanation(
  sources: AIReviewSource[],
  fetcher: typeof fetch = fetch,
): Promise<GeneratedExplanation> {
  if (!aiReviewConfigured())
    throw new AIReviewError(
      "ai_disabled",
      "AI website explanations have not been activated yet.",
    );
  const provider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
    baseURL: "https://api.openai.com/v1",
    fetch: (input, init) => fetcher(input, { ...init, redirect: "error" }),
  });
  const result = await generateText({
    model: provider.responses(AI_REVIEW_MODEL),
    system: AI_REVIEW_SYSTEM_PROMPT,
    prompt: aiReviewPrompt(sources),
    output: Output.object({
      name: "website_excerpt_explanations",
      description:
        "At most three explanations grounded in exact supplied excerpts, or abstain.",
      schema: jsonSchema<AIReviewOutput>(AI_REVIEW_OUTPUT_SCHEMA, {
        validate(value) {
          const validated = validateAIReviewOutput(value, sources);
          return validated
            ? { success: true, value: validated }
            : {
                success: false,
                error: new Error("Ungrounded website explanation"),
              };
        },
      }),
    }),
    maxOutputTokens: AI_REVIEW_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    timeout: AI_REVIEW_TIMEOUT_MS,
    reasoning: "none",
    providerOptions: { openai: { store: false, reasoningSummary: null } },
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
  });
  return { output: result.output, providerModel: result.response.modelId };
}

function cacheIdentity(sources: AIReviewSource[]) {
  const sourceHash = createHash("sha256")
    .update(canonicalJson(sources))
    .digest("hex");
  const cacheKey = createHash("sha256")
    .update(
      canonicalJson({
        sourceHash,
        model: AI_REVIEW_MODEL,
        prompt: AI_REVIEW_PROMPT_VERSION,
        schema: AI_REVIEW_SCHEMA_VERSION,
      }),
    )
    .digest("hex");
  return { sourceHash, cacheKey };
}
function rpcError(value: unknown) {
  if (!accountRecord(value) || typeof value.error !== "string") return;
  if (value.error === "not_found")
    throw new AIReviewError(
      "not_found",
      "This saved report is unavailable in your account.",
      404,
    );
  if (value.error === "ai_account_limit")
    throw new AIReviewError(
      value.error,
      "Your account’s allowance of three new explanations today has been used. Cached explanations remain available.",
      429,
    );
  if (value.error === "ai_global_limit")
    throw new AIReviewError(
      value.error,
      "The pilot’s explanation allowance has been reached. Your website findings and actions remain available.",
      429,
    );
  throw new AIReviewError();
}
function cachedReview(
  value: unknown,
  sources: AIReviewSource[],
  sourceHash: string,
): WebsiteAIReview {
  if (
    !isWebsiteAIReview(value) ||
    value.sourceHash !== sourceHash ||
    value.model !== AI_REVIEW_MODEL ||
    value.promptVersion !== AI_REVIEW_PROMPT_VERSION ||
    canonicalJson(value.sources) !== canonicalJson(sources)
  )
    throw new AIReviewError("invalid_cached_review");
  return value;
}

export function createAIReviewService(dependencies: Dependencies) {
  async function source(
    userId: string,
    reportId: string,
  ): Promise<{ report: CloudReport; sources: AIReviewSource[] }> {
    if (!accountUuid(userId) || !accountUuid(reportId))
      throw new AIReviewError(
        "not_found",
        "This saved report is unavailable in your account.",
        404,
      );
    const report = await dependencies.readReport(userId, reportId);
    if (report.canonical !== true || report.snapshot.isSample)
      throw new AIReviewError(
        "ineligible_report",
        "Choose a real report saved with the published rubric.",
        422,
      );
    return {
      report,
      sources: report.snapshot.websiteScan
        ? buildAIReviewSources(report.snapshot.websiteScan)
        : [],
    };
  }
  function base(
    report: CloudReport,
    sources: AIReviewSource[],
  ): AIReviewAvailability {
    const enabled = dependencies.configured();
    const eligible = !!report.snapshot.websiteScan && sources.length > 0;
    return {
      enabled,
      eligible,
      state: !enabled ? "disabled" : !eligible ? "ineligible" : "ready",
      reason: !enabled
        ? "AI website explanations have not been activated yet. Your scores and website findings are available without them."
        : !eligible
          ? "A saved, backed website scan with usable public excerpts is needed. Your owner-reported answers are not sent to AI."
          : "Optional explanation of saved public excerpts. Your grades will not change.",
      sourceCount: sources.length,
      scanDate: report.snapshot.websiteScan?.completedAt ?? null,
      review: null,
      cached: false,
    };
  }
  function decodeCache(
    data: unknown,
    current: AIReviewAvailability,
    sources: AIReviewSource[],
    sourceHash: string,
  ): AIReviewAvailability {
    rpcError(data);
    if (data === null) return current;
    if (
      !accountRecord(data) ||
      !["pending", "complete", "unavailable"].includes(data.status as string)
    )
      throw new AIReviewError();
    if (data.status === "complete")
      return {
        ...current,
        state: "complete",
        cached: true,
        review: cachedReview(data.review, sources, sourceHash),
        reason:
          "Saved AI explanation of these dated public excerpts. Your grades are unchanged.",
      };
    return {
      ...current,
      state: data.status as "pending" | "unavailable",
      reason:
        data.status === "pending"
          ? "An explanation is already being prepared. Check its status shortly."
          : "The previous explanation was unavailable. You can explicitly try again within the pilot allowance.",
    };
  }
  return {
    async read(
      userId: string,
      reportId: string,
    ): Promise<AIReviewAvailability> {
      const { report, sources } = await source(userId, reportId);
      const current = base(report, sources);
      if (!current.enabled || !current.eligible) return current;
      const identity = cacheIdentity(sources);
      const data = await dependencies.rpc("grader_read_ai_review", {
        p_user_id: userId,
        p_report_id: reportId,
        p_cache_key: identity.cacheKey,
      });
      return decodeCache(data, current, sources, identity.sourceHash);
    },
    async create(
      userId: string,
      reportId: string,
    ): Promise<AIReviewAvailability> {
      const { report, sources } = await source(userId, reportId);
      const current = base(report, sources);
      if (!current.enabled)
        throw new AIReviewError("ai_disabled", current.reason);
      if (!current.eligible)
        throw new AIReviewError("ineligible_report", current.reason, 422);
      const identity = cacheIdentity(sources);
      const reserved = await dependencies.rpc("grader_reserve_ai_review", {
        p_user_id: userId,
        p_report_id: reportId,
        p_cache_key: identity.cacheKey,
        p_source_hash: identity.sourceHash,
        p_model: AI_REVIEW_MODEL,
        p_prompt_version: AI_REVIEW_PROMPT_VERSION,
        p_schema_version: AI_REVIEW_SCHEMA_VERSION,
      });
      rpcError(reserved);
      if (!accountRecord(reserved) || typeof reserved.start !== "boolean")
        throw new AIReviewError();
      if (!reserved.start)
        return decodeCache(reserved, current, sources, identity.sourceHash);
      if (!accountUuid(reserved.id) || !accountUuid(reserved.leaseId))
        throw new AIReviewError();
      let review: WebsiteAIReview | null = null;
      let errorCode = "provider_unavailable";
      try {
        const generated = await dependencies.generate(sources);
        const validated = validateAIReviewOutput(generated.output, sources);
        if (
          !validated ||
          !generated.providerModel ||
          generated.providerModel.length > 100
        ) {
          errorCode = "invalid_response";
        } else
          review = {
            ...validated,
            schemaVersion: AI_REVIEW_SCHEMA_VERSION,
            promptVersion: AI_REVIEW_PROMPT_VERSION,
            model: AI_REVIEW_MODEL,
            providerModel: generated.providerModel,
            createdAt: dependencies.now().toISOString(),
            sourceHash: identity.sourceHash,
            scope: "stored_public_website_excerpts",
            scanDate: report.snapshot.websiteScan!.completedAt,
            sources,
          };
      } catch {
        /* Never log provider errors, prompts or public page instructions. */
      }
      const saved = await dependencies.rpc("grader_finish_ai_review", {
        p_user_id: userId,
        p_review_id: reserved.id,
        p_lease_id: reserved.leaseId,
        p_review: review,
        p_error_code: review ? null : errorCode,
      });
      if (saved !== true)
        throw new AIReviewError(
          "ai_request_stale",
          "The explanation could not be confirmed. Check its status before trying again.",
        );
      if (!review)
        throw new AIReviewError(
          errorCode,
          "An explanation could not be grounded in the saved excerpts. Your scores are unchanged; no explanation is shown.",
        );
      return {
        ...current,
        state: "complete",
        review,
        cached: false,
        reason: review.explanations.length
          ? "AI suggestions based only on saved public excerpts. Review them before making changes; your grades are unchanged."
          : "AI abstained because these saved excerpts did not support a useful explanation.",
      };
    },
  };
}
const configured = () =>
  createAIReviewService({
    configured: aiReviewConfigured,
    readReport: readAccountReport,
    rpc: accountRpc,
    generate: generateWebsiteExplanation,
    now: () => new Date(),
  });
export const readWebsiteAIReview = (userId: string, reportId: string) =>
  configured().read(userId, reportId);
export const createWebsiteAIReview = (userId: string, reportId: string) =>
  configured().create(userId, reportId);

export interface ExportedWebsiteAIReview {
  reportId: string;
  status: "pending" | "complete" | "unavailable";
  requestedAt: string;
  completedAt: string | null;
  consentVersion: string;
  consentText: string;
  review: WebsiteAIReview | null;
}

/** Export only the owner's explanation and consent record, never leases or quota keys. */
export function createAIReviewMaintenance(rpc: typeof accountRpc = accountRpc) {
  const date = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value));
  return {
    async exportReviews(userId: string): Promise<ExportedWebsiteAIReview[]> {
      if (!accountUuid(userId)) throw new AIReviewError();
      const data = await rpc("grader_export_ai_reviews", {
        p_user_id: userId,
      });
      if (!Array.isArray(data) || data.length > 5000) throw new AIReviewError();
      return data.map((row) => {
        if (
          !accountRecord(row) ||
          Object.keys(row).some(
            (key) =>
              ![
                "reportId",
                "status",
                "requestedAt",
                "completedAt",
                "consentVersion",
                "consentText",
                "review",
              ].includes(key),
          ) ||
          !accountUuid(row.reportId) ||
          !["pending", "complete", "unavailable"].includes(
            row.status as string,
          ) ||
          !date(row.requestedAt) ||
          (row.completedAt !== null && !date(row.completedAt)) ||
          typeof row.consentVersion !== "string" ||
          row.consentVersion.length > 100 ||
          typeof row.consentText !== "string" ||
          row.consentText.length > 500 ||
          (row.status === "complete"
            ? !isWebsiteAIReview(row.review)
            : row.review !== null)
        )
          throw new AIReviewError();
        return structuredClone(row) as unknown as ExportedWebsiteAIReview;
      });
    },
    async purgeUsage(): Promise<{
      attemptsRemoved: number;
      staleMarked: number;
    }> {
      const data = await rpc("grader_purge_ai_review_usage");
      if (
        !accountRecord(data) ||
        !Number.isSafeInteger(data.attemptsRemoved) ||
        (data.attemptsRemoved as number) < 0 ||
        !Number.isSafeInteger(data.staleMarked) ||
        (data.staleMarked as number) < 0
      )
        throw new AIReviewError();
      return {
        attemptsRemoved: data.attemptsRemoved as number,
        staleMarked: data.staleMarked as number,
      };
    },
  };
}
export const exportWebsiteAIReviews = (userId: string) =>
  createAIReviewMaintenance().exportReviews(userId);
export const purgeAIReviewUsage = () =>
  createAIReviewMaintenance().purgeUsage();
