import type { WebsitePerformance } from "../website/types";
import { normalizeWebsiteUrl, resolvePublicAddress } from "./website-fetch";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const shortText = (value: unknown, max = 800): string =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

export function unavailablePerformance(
  sourceUrl: string,
  reason: string,
): WebsitePerformance {
  return {
    status: "unavailable",
    provider: "google-pagespeed",
    strategy: "mobile",
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    reason,
    categories: {},
    metrics: [],
    opportunities: [],
  };
}

/** Retain bounded measurements, not Google's raw response, screenshots or page contents. */
export function parsePageSpeedResponse(
  payload: unknown,
  sourceUrl: string,
  fetchedAt = new Date().toISOString(),
): WebsitePerformance {
  if (
    !object(payload) ||
    !object(payload.lighthouseResult) ||
    object(payload.lighthouseResult.runtimeError)
  )
    return unavailablePerformance(
      sourceUrl,
      "Google could not complete the mobile laboratory audit. Unmeasured checks do not reduce your score.",
    );
  const lighthouse = payload.lighthouseResult;
  const categories: WebsitePerformance["categories"] = {};
  if (object(lighthouse.categories))
    for (const key of [
      "performance",
      "accessibility",
      "seo",
      "best-practices",
    ] as const) {
      const category = lighthouse.categories[key];
      if (
        object(category) &&
        typeof category.score === "number" &&
        Number.isFinite(category.score) &&
        category.score >= 0 &&
        category.score <= 1
      )
        categories[key] = Math.round(category.score * 100);
    }
  if (!Object.keys(categories).length)
    return unavailablePerformance(
      sourceUrl,
      "Google returned no usable mobile audit scores. Unmeasured checks do not reduce your score.",
    );
  const metrics: WebsitePerformance["metrics"] = [];
  const opportunities: WebsitePerformance["opportunities"] = [];
  const audits = object(lighthouse.audits) ? lighthouse.audits : {};
  for (const [id, label, unit] of [
    ["first-contentful-paint", "First contentful paint", "ms"],
    ["largest-contentful-paint", "Largest contentful paint", "ms"],
    ["speed-index", "Speed index", "ms"],
    ["total-blocking-time", "Total blocking time", "ms"],
    ["cumulative-layout-shift", "Cumulative layout shift", "unitless"],
  ] as const) {
    const audit = audits[id];
    if (
      object(audit) &&
      typeof audit.numericValue === "number" &&
      Number.isFinite(audit.numericValue) &&
      audit.numericValue >= 0
    )
      metrics.push({
        id,
        label,
        value: Math.round(audit.numericValue * 1000) / 1000,
        unit,
      });
  }
  for (const [id, raw] of Object.entries(audits).slice(0, 500)) {
    if (
      !object(raw) ||
      typeof raw.score !== "number" ||
      raw.score >= 0.9 ||
      raw.score < 0 ||
      !shortText(raw.title)
    )
      continue;
    const details = object(raw.details) ? raw.details : {};
    const savingsMs =
      typeof details.overallSavingsMs === "number" &&
      Number.isFinite(details.overallSavingsMs) &&
      details.overallSavingsMs > 0
        ? Math.round(details.overallSavingsMs)
        : undefined;
    // Only retain performance improvement opportunities with an estimated time saving.
    if (savingsMs === undefined) continue;
    opportunities.push({
      id: id.slice(0, 100),
      title: shortText(raw.title, 300),
      description: shortText(raw.description),
      savingsMs,
    });
  }
  opportunities.sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0));
  return {
    status: "available",
    provider: "google-pagespeed",
    strategy: "mobile",
    fetchedAt,
    sourceUrl,
    categories,
    metrics,
    opportunities: opportunities.slice(0, 5),
    ...(typeof lighthouse.lighthouseVersion === "string"
      ? { lighthouseVersion: lighthouse.lighthouseVersion.slice(0, 100) }
      : {}),
  };
}

/** Fixed Google endpoint; key is server-only. Quota errors stay unmeasured rather than zero. */
export async function runMobilePerformance(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<WebsitePerformance> {
  const url = normalizeWebsiteUrl(input);
  await resolvePublicAddress(url);
  const endpoint = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  endpoint.searchParams.set("url", url.href);
  endpoint.searchParams.set("strategy", "mobile");
  for (const category of [
    "performance",
    "accessibility",
    "seo",
    "best-practices",
  ])
    endpoint.searchParams.append("category", category);
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) endpoint.searchParams.set("key", apiKey);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(65_000),
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      return unavailablePerformance(
        url.href,
        response.status === 429 || response.status === 403
          ? "Google's mobile audit quota is currently unavailable. Website observations are still useful; unmeasured checks do not reduce your score."
          : "Google's mobile audit is temporarily unavailable. Unmeasured checks do not reduce your score.",
      );
    if (!response.body)
      return unavailablePerformance(
        url.href,
        "Google returned no mobile audit data.",
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 6_000_000) {
        await reader.cancel();
        return unavailablePerformance(
          url.href,
          "The mobile audit response exceeded this pilot's size limit.",
        );
      }
      chunks.push(next.value);
    }
    return parsePageSpeedResponse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      url.href,
    );
  } catch {
    return unavailablePerformance(
      url.href,
      "Google's mobile audit did not finish within the scan window. Unmeasured checks do not reduce your score.",
    );
  }
}
