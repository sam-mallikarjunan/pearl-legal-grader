import { load } from "cheerio";
import { evaluateWebsite } from "../website/evaluate";
import {
  WEBSITE_RUBRIC_VERSION,
  WEBSITE_SCANNER_VERSION,
  type WebsitePage,
  type WebsitePerformance,
  type WebsiteScanProgress,
  type WebsiteScanResult,
  type WebsiteSuggestedContext,
  type WebsiteTechnology,
} from "../website/types";
import {
  fetchPublicWebsite,
  normalizeWebsiteUrl,
  parseRobots,
  robotsAllows,
  WebsiteFetchError,
  type RobotsPolicy,
} from "./website-fetch";
import { runMobilePerformance, unavailablePerformance } from "./pagespeed";

const clean = (value: string | undefined, max = 300): string =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const PRACTICE_AREAS: Array<[string, RegExp]> = [
  ["Family law", /\b(?:family law|divorce|child custody)\b/i],
  ["Estate planning", /\b(?:estate planning|wills? and trusts?|probate)\b/i],
  [
    "Criminal defense",
    /\b(?:criminal defen[cs]e|dui defen[cs]e|criminal law)\b/i,
  ],
  [
    "Personal injury",
    /\b(?:personal injury|injury attorney|accident lawyer)\b/i,
  ],
  ["Immigration", /\bimmigration\b/i],
  ["Employment law", /\b(?:employment law|employment attorney|labor law)\b/i],
  ["Business law", /\b(?:business law|corporate law|business attorney)\b/i],
  [
    "Real estate law",
    /\b(?:real estate law|property law|real estate attorney)\b/i,
  ],
  ["Bankruptcy", /\bbankruptcy\b/i],
  [
    "Intellectual property",
    /\b(?:intellectual property|patent law|trademark law)\b/i,
  ],
  ["Tax law", /\b(?:tax law|tax attorney)\b/i],
  ["Civil litigation", /\b(?:civil litigation|commercial litigation)\b/i],
  ["Elder law", /\belder law\b/i],
  ["Consumer law", /\b(?:consumer law|consumer protection)\b/i],
];

interface Candidate {
  url: string;
  kind: Exclude<WebsitePage["kind"], "home">;
  rank: number;
}
interface ParsedPage {
  page: WebsitePage;
  candidates: Candidate[];
  technologies: WebsiteTechnology[];
  context: WebsiteSuggestedContext;
}

const LINK_KINDS: Array<[Candidate["kind"], RegExp]> = [
  ["contact", /(?:contact|reach-us|get-in-touch)/i],
  ["services", /(?:services|practice[-_ ]?areas?|what-we-do|how-we-help)/i],
  ["about", /(?:about|our[-_ ]?team|attorneys|lawyers|people|who-we-are)/i],
  ["fees", /(?:pricing|fees|costs|frequently-asked|faq)/i],
];

/** Static HTML only: scripts are inspected as text, never executed. Safe to exercise with fixtures. */
export function parseWebsitePage(
  html: string,
  url: string,
  kind: WebsitePage["kind"],
  fetchedAt: string,
  httpStatus = 200,
  noindexHeader = false,
): ParsedPage {
  const $ = load(html);
  $("[hidden],[aria-hidden='true'],template,noscript").remove();
  $("[style]").each((_i, el) => {
    if (
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        $(el).attr("style") ?? "",
      )
    )
      $(el).remove();
  });
  const evidence = (detail: string) => ({
    sourceUrl: url,
    observedAt: fetchedAt,
    detail,
  });
  const meta = (name: string) =>
    clean($(`meta[name="${name}" i]`).first().attr("content"), 600);
  const origin = new URL(url).origin;
  const linkElements = $("a[href]").toArray().slice(0, 800);
  const links = linkElements.map((element) => ({
    href: $(element).attr("href") ?? "",
    text: clean($(element).text(), 160),
  }));
  const candidates: Candidate[] = [];
  for (const link of links) {
    try {
      const href = normalizeWebsiteUrl(new URL(link.href, url).href);
      if (
        href.origin !== origin ||
        href.href === url ||
        /\.(?:pdf|docx?|xlsx?|zip|jpe?g|png|gif|svg|webp|mp[34]|xml|json|css|js)(?:$|\/)/i.test(
          href.pathname,
        )
      )
        continue;
      for (const [candidateKind, pattern] of LINK_KINDS)
        if (pattern.test(`${href.pathname} ${link.text}`)) {
          const depth = href.pathname.split("/").filter(Boolean).length;
          candidates.push({
            url: href.href,
            kind: candidateKind,
            rank:
              (pattern.test(href.pathname) ? 10 : 0) +
              (depth <= 1 ? 5 : 0) -
              depth,
          });
          break;
        }
    } catch {
      /* Unsafe, private, query-bearing and non-web links are not followed. */
    }
  }

  const scripts = $("script[src],iframe[src],link[href]")
    .toArray()
    .slice(0, 800)
    .map((el) => $(el).attr("src") ?? $(el).attr("href") ?? "")
    .join("\n");
  const inlineScript = $("script:not([src])")
    .toArray()
    .slice(0, 100)
    .map((el) => $(el).text().slice(0, 10_000))
    .join("\n")
    .slice(0, 250_000);
  const technologies: WebsiteTechnology[] = [];
  const detect = (
    name: string,
    category: WebsiteTechnology["category"],
    detected: boolean,
    detail: string,
  ) => {
    if (detected)
      technologies.push({ name, category, evidence: evidence(detail) });
  };
  detect(
    "Google Analytics",
    "analytics",
    /(?:google-analytics\.com|googletagmanager\.com\/gtag\/js|\bgtag\s*\(\s*['"]config['"]\s*,\s*['"]G-)/i.test(
      `${scripts}\n${inlineScript}`,
    ),
    "A Google Analytics-related script or configuration marker was found in the page HTML.",
  );
  detect(
    "Google Tag Manager",
    "analytics",
    /googletagmanager\.com\/(?:gtm\.js|ns\.html)/i.test(
      `${scripts}\n${inlineScript}`,
    ),
    "A Google Tag Manager script marker was found in the page HTML.",
  );
  detect(
    "Meta Pixel",
    "advertising",
    /connect\.facebook\.net\/.*fbevents|\bfbq\s*\(/i.test(
      `${scripts}\n${inlineScript}`,
    ),
    "A Meta Pixel-related script marker was found in the page HTML.",
  );
  detect(
    "Microsoft Clarity",
    "analytics",
    /clarity\.ms\/tag\//i.test(`${scripts}\n${inlineScript}`),
    "A Microsoft Clarity script marker was found in the page HTML.",
  );
  detect(
    "Hotjar",
    "analytics",
    /(?:static|script)\.hotjar\.com/i.test(`${scripts}\n${inlineScript}`),
    "A Hotjar script marker was found in the page HTML.",
  );
  detect(
    "Intercom",
    "chat",
    /(?:widget\.intercom\.io|js\.intercomcdn\.com)/i.test(scripts),
    "An Intercom script marker was found in the page HTML.",
  );
  detect(
    "LiveChat",
    "chat",
    /cdn\.livechatinc\.com/i.test(`${scripts}\n${inlineScript}`),
    "A LiveChat script marker was found in the page HTML.",
  );
  detect(
    "Tidio",
    "chat",
    /code\.tidio\.co/i.test(scripts),
    "A Tidio script marker was found in the page HTML.",
  );
  detect(
    "Calendly",
    "booking",
    /(?:^|\/\/)calendly\.com(?:\/|$)|assets\.calendly\.com/i.test(
      `${scripts}\n${links.map((l) => l.href).join("\n")}`,
    ),
    "A Calendly link or embed marker was found in the page HTML.",
  );
  detect(
    "Acuity Scheduling",
    "booking",
    /acuityscheduling\.com/i.test(
      `${scripts}\n${links.map((l) => l.href).join("\n")}`,
    ),
    "An Acuity Scheduling link or embed marker was found in the page HTML.",
  );
  detect(
    "WordPress",
    "platform",
    /wp-content\/|wp-includes\//i.test(scripts) ||
      /wordpress/i.test(meta("generator")),
    "WordPress asset paths or a generator marker were found.",
  );
  detect(
    "Wix",
    "platform",
    /wixstatic\.com|parastorage\.com/i.test(scripts) ||
      /wix/i.test(meta("generator")),
    "Wix asset paths or a generator marker were found.",
  );
  detect(
    "Squarespace",
    "platform",
    /squarespace\.com|squarespace-cdn\.com/i.test(scripts) ||
      /squarespace/i.test(meta("generator")),
    "Squarespace asset paths or a generator marker were found.",
  );
  detect(
    "Webflow",
    "platform",
    Boolean($("html").attr("data-wf-site")) ||
      /webflow/i.test(meta("generator")),
    "A Webflow site or generator marker was found.",
  );

  const context: WebsiteSuggestedContext = {
    firmName: null,
    practiceAreas: [],
    locations: [],
    evidence: [],
    requiresConfirmation: true,
  };
  const nodes: Record<string, unknown>[] = [];
  const collect = (v: unknown, depth: number) => {
    if (depth > 4 || nodes.length >= 100) return;
    if (Array.isArray(v))
      for (const item of v.slice(0, 50)) collect(item, depth + 1);
    else if (isObject(v)) {
      nodes.push(v);
      if (v["@graph"]) collect(v["@graph"], depth + 1);
    }
  };
  for (const script of $("script[type='application/ld+json']")
    .toArray()
    .slice(0, 10)) {
    try {
      const raw = $(script).text();
      if (raw.length < 100_000) collect(JSON.parse(raw), 0);
    } catch {
      /* Invalid structured data is not treated as verified evidence. */
    }
  }
  for (const node of nodes) {
    const type = Array.isArray(node["@type"])
      ? node["@type"].join(" ")
      : String(node["@type"] ?? "");
    if (!/LegalService|Attorney|Organization|LocalBusiness/i.test(type))
      continue;
    if (!context.firmName && typeof node.name === "string") {
      context.firmName = clean(node.name);
      context.evidence.push(
        evidence(
          "Firm name suggested from organization/legal-service structured data; owner confirmation is required.",
        ),
      );
    }
    const address = node.address;
    if (isObject(address)) {
      const location = [
        address.addressLocality,
        address.addressRegion,
        address.addressCountry,
      ]
        .filter((v): v is string => typeof v === "string")
        .map((v) => clean(v, 80))
        .filter(Boolean)
        .join(", ");
      if (location && !context.locations.includes(location)) {
        context.locations.push(location);
        context.evidence.push(
          evidence(
            "Location text suggested from public address structured data; service area and licensing are not verified.",
          ),
        );
      }
    }
  }
  if (!context.firmName) {
    const siteName = clean(
      $("meta[property='og:site_name']").first().attr("content"),
    );
    if (siteName) {
      context.firmName = siteName;
      context.evidence.push(
        evidence(
          "Firm/site name suggested from the page's og:site_name metadata; owner confirmation is required.",
        ),
      );
    }
  }
  // Remove non-visible/executable elements before extracting textual presence signals.
  $(
    "script,style,noscript,template,svg,[hidden],[aria-hidden='true']",
  ).remove();
  const bodyText = clean($("body").text(), 120_000);
  context.practiceAreas = PRACTICE_AREAS.filter(([, regex]) =>
    regex.test(bodyText),
  ).map(([label]) => label);
  if (context.practiceAreas.length)
    context.evidence.push(
      evidence(
        `Practice-area wording detected: ${context.practiceAreas.join(", ")}. These are text suggestions, not verified services.`,
      ),
    );
  context.locations = context.locations.slice(0, 5);
  context.evidence = context.evidence.slice(0, 8);

  let formControlCount = 0;
  let unlabeledFormControlCount = 0;
  $("input,select,textarea")
    .slice(0, 500)
    .each((_i, el) => {
      const element = $(el);
      if (
        ["hidden", "submit", "button", "reset", "image"].includes(
          (element.attr("type") ?? "").toLowerCase(),
        )
      )
        return;
      formControlCount++;
      const id = element.attr("id");
      const forLabel = id
        ? $("label[for]")
            .toArray()
            .some(
              (label) =>
                $(label).attr("for") === id &&
                clean($(label).text()).length > 0,
            )
        : false;
      const labelledBy = (element.attr("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .some((ref) =>
          $("[id]")
            .toArray()
            .some(
              (candidate) =>
                $(candidate).attr("id") === ref &&
                clean($(candidate).text()).length > 0,
            ),
        );
      if (
        !forLabel &&
        !element.closest("label").length &&
        !clean(element.attr("aria-label")) &&
        !labelledBy &&
        !clean(element.attr("title"))
      )
        unlabeledFormControlCount++;
    });
  const images = $("img").slice(0, 1000);
  const visibleWordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const signals = {
    title: clean($("title").first().text(), 300) || null,
    description: meta("description") || null,
    h1Count: $("h1").length,
    h1: $("h1")
      .slice(0, 5)
      .toArray()
      .map((el) => clean($(el).text(), 200))
      .filter(Boolean),
    hasViewport: /width\s*=\s*device-width/i.test(meta("viewport")),
    hasCanonical: $("link[rel='canonical'][href]").length > 0,
    noindex:
      noindexHeader ||
      /(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(
        `${meta("robots")} ${meta("googlebot")}`,
      ),
    hasStructuredData: nodes.length > 0,
    hasPhoneLink: links.some((l) => /^tel:\+?[\d\s().-]{3,}/i.test(l.href)),
    hasEmailLink: links.some((l) =>
      /^mailto:[^?\s@]+@[^?\s@]+\.[^?\s@]+/i.test(l.href),
    ),
    hasContactForm: $("form")
      .toArray()
      .some(
        (form) =>
          $(form).find(
            "input[type='email'],textarea,input[name*='email' i],input[name*='message' i]",
          ).length > 0,
      ),
    hasBookingLink:
      technologies.some((t) => t.category === "booking") ||
      links.some((l) =>
        /(?:book|schedule|request).*(?:consultation|appointment)|(?:consultation|appointment).*(?:book|schedule)/i.test(
          l.text,
        ),
      ),
    hasContactLink: candidates.some((c) => c.kind === "contact"),
    hasConsultationLanguage:
      /\b(?:consultation|schedule (?:a |an |your )?(?:call|appointment)|request (?:a |an )?(?:call|appointment)|get in touch|contact us|contact me)\b/i.test(
        bodyText,
      ),
    hasServiceLanguage:
      context.practiceAreas.length > 0 ||
      /\b(?:practice areas|legal services|our services|services we (?:offer|provide))\b/i.test(
        bodyText,
      ),
    hasPeopleLanguage:
      /\b(?:our team|our attorneys|our lawyers|meet (?:the|your|our)|attorney bio|about (?:us|me|the firm)|bar admissions|admitted to practice)\b/i.test(
        bodyText,
      ),
    hasLocationLanguage:
      context.locations.length > 0 ||
      $("address").length > 0 ||
      /\b(?:serving|we serve|service area|our office|office location|located in)\b/i.test(
        bodyText,
      ),
    imageCount: images.length,
    imagesMissingAlt: images
      .toArray()
      .filter((el) => $(el).attr("alt") === undefined).length,
    formControlCount,
    unlabeledFormControlCount,
    visibleWordCount,
    likelyJavascriptShell: visibleWordCount < 40 && scriptCount > 0,
  };
  return {
    page: { url, kind, status: "inspected", fetchedAt, httpStatus, signals },
    candidates,
    technologies,
    context,
  };
}

export interface InspectWebsiteOptions {
  performanceProvider?: (url: string) => Promise<WebsitePerformance>;
  /** Test seam; production callers should use the DNS-pinned default. */
  fetcher?: typeof fetchPublicWebsite;
}

/** Bounded five-page scan. Public HTML and a separate mobile provider; no logins or submissions. */
export async function inspectWebsite(
  input: string,
  onProgress?: (progress: WebsiteScanProgress) => void | Promise<void>,
  options: InspectWebsiteOptions = {},
): Promise<WebsiteScanResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const deadline = started + 75_000;
  const submitted = normalizeWebsiteUrl(input);
  const fetcher = options.fetcher ?? fetchPublicWebsite;
  const pages: WebsitePage[] = [];
  const warnings: string[] = [];
  const technologies = new Map<string, WebsiteTechnology>();
  const suggestedContext: WebsiteSuggestedContext = {
    firmName: null,
    practiceAreas: [],
    locations: [],
    evidence: [],
    requiresConfirmation: true,
  };
  const policies = new Map<string, RobotsPolicy>();
  const lastRequests = new Map<string, number>();
  const progress = async (
    stage: WebsiteScanProgress["stage"],
    message: string,
  ) => {
    await onProgress?.({
      stage,
      message,
      pagesInspected: pages.filter((p) => p.status === "inspected").length,
    });
  };
  const getPolicy = async (origin: string): Promise<RobotsPolicy> => {
    const prior = policies.get(origin);
    if (prior) return prior;
    if (policies.size >= 5)
      throw new WebsiteFetchError(
        "robots",
        "The website redirected across too many origins to inspect politely.",
      );
    const result = await fetcher(`${origin}/robots.txt`, {
      timeoutMs: 7000,
      maxBytes: 256_000,
      maxRedirects: 3,
      accept: "text",
    });
    lastRequests.set(origin, Date.now());
    let policy: RobotsPolicy;
    if (result.status >= 200 && result.status < 300)
      policy = parseRobots(result.body);
    else if (
      result.status >= 400 &&
      result.status < 500 &&
      ![401, 403, 429].includes(result.status)
    )
      policy = { rules: [], crawlDelaySeconds: 0 };
    else
      throw new WebsiteFetchError(
        "robots",
        "The website's robots policy was unavailable or denied automated access; this scan stopped rather than assuming permission.",
      );
    policies.set(origin, policy);
    return policy;
  };
  const authorize = async (url: URL) => {
    const policy = await getPolicy(url.origin);
    if (!robotsAllows(policy, url))
      throw new WebsiteFetchError(
        "robots",
        "The website's robots.txt asks this crawler not to inspect this page.",
      );
    if (policy.crawlDelaySeconds > 5)
      throw new WebsiteFetchError(
        "robots",
        "The website requests a crawl delay longer than this pilot's scan window; this page was skipped.",
      );
    const delay =
      Math.max(500, policy.crawlDelaySeconds * 1000) -
      (Date.now() - (lastRequests.get(url.origin) ?? 0));
    if (Date.now() + Math.max(delay, 0) >= deadline)
      throw new WebsiteFetchError(
        "timeout",
        "The bounded website inspection window ended.",
      );
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequests.set(url.origin, Date.now());
  };
  const inspectPage = async (
    url: string,
    kind: WebsitePage["kind"],
    allowedOrigin?: string,
  ): Promise<ParsedPage | null> => {
    const fetchedAt = new Date().toISOString();
    try {
      const response = await fetcher(url, {
        timeoutMs: Math.min(12_000, Math.max(1, deadline - Date.now())),
        maxBytes: 1_500_000,
        maxRedirects: 3,
        ...(allowedOrigin ? { allowedOrigin } : {}),
        authorize,
      });
      if (response.status < 200 || response.status >= 300) {
        pages.push({
          url: response.url,
          kind,
          status: [401, 403, 429].includes(response.status)
            ? "blocked"
            : "unavailable",
          fetchedAt,
          httpStatus: response.status,
          reason: `The website returned HTTP ${response.status}; page contents were not graded.`,
        });
        return null;
      }
      if (
        kind !== "home" &&
        pages.some((p) => p.status === "inspected" && p.url === response.url)
      ) {
        pages.push({
          url: response.url,
          kind,
          status: "unavailable",
          fetchedAt,
          httpStatus: response.status,
          reason:
            "This link returned a page already inspected. It was not counted as a distinct services, contact or profile page.",
        });
        return null;
      }
      if (
        /\b(?:just a moment|verify (?:that )?you are human|checking your browser|access denied|attention required!.*cloudflare)\b/i.test(
          response.body.slice(0, 25_000),
        ) &&
        /(?:challenge-platform|cf-chl-|captcha|cloudflare)/i.test(response.body)
      ) {
        pages.push({
          url: response.url,
          kind,
          status: "blocked",
          fetchedAt,
          httpStatus: response.status,
          reason:
            "An automated-access challenge was returned. The scanner did not bypass it or grade the challenge page.",
        });
        return null;
      }
      const effectiveKind =
        kind === "home"
          ? "home"
          : (LINK_KINDS.find(([, pattern]) =>
              pattern.test(new URL(response.url).pathname),
            )?.[0] ?? kind);
      const parsed = parseWebsitePage(
        response.body,
        response.url,
        effectiveKind,
        fetchedAt,
        response.status,
        /\b(?:noindex|none)\b/i.test(
          String(response.headers["x-robots-tag"] ?? ""),
        ),
      );
      pages.push(parsed.page);
      for (const technology of parsed.technologies)
        if (!technologies.has(technology.name))
          technologies.set(technology.name, technology);
      suggestedContext.firmName ??= parsed.context.firmName;
      suggestedContext.practiceAreas = [
        ...new Set([
          ...suggestedContext.practiceAreas,
          ...parsed.context.practiceAreas,
        ]),
      ].slice(0, 20);
      suggestedContext.locations = [
        ...new Set([
          ...suggestedContext.locations,
          ...parsed.context.locations,
        ]),
      ].slice(0, 5);
      suggestedContext.evidence.push(...parsed.context.evidence);
      suggestedContext.evidence = suggestedContext.evidence.slice(0, 10);
      if (parsed.page.signals!.likelyJavascriptShell)
        warnings.push(
          "At least one page exposes little content before JavaScript runs. Missing HTML signals on that page remain unmeasured; the mobile laboratory audit is separate from this static inspection.",
        );
      return parsed;
    } catch (error) {
      pages.push({
        url,
        kind,
        status:
          error instanceof WebsiteFetchError &&
          ["robots", "unsafe_url"].includes(error.code)
            ? "blocked"
            : "unavailable",
        fetchedAt,
        reason:
          error instanceof WebsiteFetchError
            ? error.message
            : "This page could not be inspected within the pilot limits.",
      });
      return null;
    }
  };

  await progress(
    "checking",
    "Checking the public website address and robots policy.",
  );
  const home = await inspectPage(submitted.href, "home");
  let performance: WebsitePerformance;
  if (home) {
    await progress(
      "inspecting",
      "Inspecting public contact, services and practice information.",
    );
    // The performance request can run while the bounded HTML inspection continues.
    const provider = options.performanceProvider ?? runMobilePerformance;
    const performancePromise = provider(home.page.url).catch(() =>
      unavailablePerformance(
        home.page.url,
        "The mobile audit provider could not inspect this website. Unmeasured checks do not reduce your score.",
      ),
    );
    const candidates = home.candidates.sort((a, b) => b.rank - a.rank);
    const visited = new Set([home.page.url, submitted.href]);
    for (const kind of ["contact", "services", "about", "fees"] as const) {
      const candidate = candidates.find(
        (c) => c.kind === kind && !visited.has(c.url),
      );
      if (!candidate || Date.now() >= deadline || pages.length >= 5) continue;
      visited.add(candidate.url);
      await inspectPage(candidate.url, kind, new URL(home.page.url).origin);
      await progress(
        "inspecting",
        `Inspected ${pages.filter((p) => p.status === "inspected").length} public pages so far.`,
      );
    }
    await progress(
      "performance",
      "Collecting the mobile laboratory audit when available.",
    );
    performance = await performancePromise;
  } else
    performance = unavailablePerformance(
      submitted.href,
      "The homepage was not available for inspection, so a mobile audit was not requested.",
    );
  await progress(
    "evaluating",
    "Turning observed evidence into website findings and next actions.",
  );
  const evaluation = evaluateWebsite(pages, performance);
  const inspectedCount = pages.filter((p) => p.status === "inspected").length;
  const partial =
    pages.some(
      (p) => p.status !== "inspected" || p.signals?.likelyJavascriptShell,
    ) || performance.status !== "available";
  if (performance.status === "unavailable")
    warnings.push(
      performance.reason ??
        "The mobile audit was unavailable; related checks remain unmeasured.",
    );
  if (pages.some((p) => p.status !== "inspected"))
    warnings.push(
      "Some pages could not be inspected. Their contents were not assigned failing scores.",
    );
  return {
    scannerVersion: WEBSITE_SCANNER_VERSION,
    rubricVersion: WEBSITE_RUBRIC_VERSION,
    status:
      inspectedCount === 0 ? "unavailable" : partial ? "partial" : "complete",
    submittedUrl: submitted.href,
    finalUrl: home?.page.url ?? null,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    pages,
    ...evaluation,
    suggestedContext,
    technologies: [...technologies.values()].slice(0, 30),
    performance,
    warnings: [...new Set(warnings)],
    limitations: [
      "This is a bounded inspection of up to five public pages, not a full crawl or a security, accessibility or legal-compliance certification.",
      "Static HTML checks do not execute website scripts, submit forms, place calls, test booking completion or verify analytics configuration.",
      "Practice names, services and location suggestions are extracted text clues and require owner confirmation.",
      "The website score uses provisional, versioned rules and measured checks only. It remains separate from owner-reported practice maturity.",
      "Mobile laboratory measurements can vary between runs. Real-user field data is not included in this version.",
    ],
  };
}
