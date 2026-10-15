import type {
  WebsiteAction,
  WebsiteCategory,
  WebsiteEvidence,
  WebsiteFinding,
  WebsitePage,
  WebsitePerformance,
} from "./types";

const action = (
  title: string,
  why: string,
  steps: string[],
  effort: WebsiteAction["effort"] = "small",
): WebsiteAction => ({ title, why, steps, effort });
const evidenceFor = (page: WebsitePage, detail: string): WebsiteEvidence => ({
  sourceUrl: page.url,
  observedAt: page.fetchedAt,
  detail,
});

export interface WebsiteEvaluation {
  findings: WebsiteFinding[];
  score: number | null;
  coverage: number;
  measuredChecks: number;
  totalChecks: number;
}

/** Literal, provisional website checks. Owner maturity answers are never inputs to this score. */
export function evaluateWebsite(
  pages: WebsitePage[],
  performance: WebsitePerformance,
): WebsiteEvaluation {
  const inspected = pages.filter((p) => p.status === "inspected" && p.signals);
  const home = inspected.find((p) => p.kind === "home");
  const readable = inspected.filter((p) => !p.signals!.likelyJavascriptShell);
  const findings: WebsiteFinding[] = [];
  const add = (
    id: string,
    category: WebsiteCategory,
    title: string,
    weight: number,
    points: number | null,
    summary: string,
    evidence: WebsiteEvidence[],
    next?: WebsiteAction,
    limitation?: string,
  ) => {
    findings.push({
      id,
      category,
      title,
      weight,
      points,
      status:
        points === null ? "unknown" : points >= 90 ? "pass" : "needs_attention",
      summary,
      evidence: evidence.slice(0, 5),
      method: "html",
      ...(points !== null && points < 90 && next ? { action: next } : {}),
      ...(limitation ? { limitation } : {}),
    });
  };
  const incompleteContent = pages.some(
    (p) => p.status !== "inspected" || p.signals?.likelyJavascriptShell,
  );
  const any = (predicate: (p: WebsitePage) => boolean): number | null =>
    inspected.some(predicate)
      ? 100
      : readable.length && !incompleteContent
        ? 0
        : null;
  const fraction = (predicate: (p: WebsitePage) => boolean): number | null =>
    readable.length
      ? Math.round((readable.filter(predicate).length / readable.length) * 100)
      : null;
  const unknown =
    "We could not reliably measure this check from the pages available to the scanner.";

  const https = home ? (home.url.startsWith("https:") ? 100 : 0) : null;
  add(
    "https",
    "availability",
    "HTTPS on the scanned homepage",
    5,
    https,
    https === 100
      ? "The homepage was fetched over HTTPS with certificate validation enabled."
      : https === 0
        ? "The scanned homepage was served over HTTP."
        : unknown,
    home
      ? [evidenceFor(home, `Homepage protocol: ${new URL(home.url).protocol}`)]
      : [],
    action(
      "Serve your public site over HTTPS",
      "HTTPS protects information in transit and gives visitors a safer route to your site.",
      [
        "Ask your website host to enable a valid TLS certificate.",
        "Redirect public HTTP pages to their HTTPS equivalents.",
        "Check the site for mixed-content warnings, then rescan.",
      ],
    ),
  );

  const contact = any(
    (p) =>
      p.signals!.hasPhoneLink ||
      p.signals!.hasEmailLink ||
      p.signals!.hasContactForm ||
      p.signals!.hasBookingLink,
  );
  add(
    "contact-route",
    "contact",
    "A visible way to contact the practice",
    12,
    contact,
    contact === 100
      ? "At least one phone, email, contact-form or booking element appeared in the inspected HTML."
      : contact === 0
        ? "No direct contact element was detected in the inspected HTML."
        : unknown,
    inspected.map((p) =>
      evidenceFor(
        p,
        `Phone link: ${p.signals!.hasPhoneLink ? "yes" : "not found"}; email link: ${p.signals!.hasEmailLink ? "yes" : "not found"}; contact form: ${p.signals!.hasContactForm ? "yes" : "not found"}; booking link: ${p.signals!.hasBookingLink ? "yes" : "not found"}.`,
      ),
    ),
    action(
      "Make contacting your practice easy",
      "A prospective client needs an obvious next step before they can become a good-fit enquiry.",
      [
        "Add a prominent phone link and a clear contact or consultation button.",
        "Check those links on a phone.",
        "Send a test enquiry yourself and confirm someone receives it.",
      ],
    ),
    "Presence does not establish that links, forms or booking flows work or are monitored. The scanner submits nothing.",
  );

  const navigation = home
    ? home.signals!.hasContactLink ||
      home.signals!.hasPhoneLink ||
      home.signals!.hasEmailLink ||
      home.signals!.hasContactForm ||
      home.signals!.hasBookingLink
      ? 100
      : home.signals!.likelyJavascriptShell
        ? null
        : 0
    : null;
  add(
    "home-contact",
    "contact",
    "A contact route from the homepage",
    8,
    navigation,
    navigation === 100
      ? "The homepage includes a contact link, phone/email link, form or booking element."
      : navigation === 0
        ? "A direct contact route was not detected on the homepage."
        : unknown,
    home
      ? [
          evidenceFor(
            home,
            `Contact navigation/link: ${home.signals!.hasContactLink ? "detected" : "not detected"}; direct phone/email/form/booking element: ${home.signals!.hasPhoneLink || home.signals!.hasEmailLink || home.signals!.hasContactForm || home.signals!.hasBookingLink ? "detected" : "not detected"}.`,
          ),
        ]
      : [],
    action(
      "Put a clear next step on your homepage",
      "Visitors should be able to find how to speak with you without searching through the site.",
      [
        "Place a descriptive contact or consultation link near the top of the homepage.",
        "Include a contact route in the main navigation.",
        "Verify that it leads to the intended public page.",
      ],
    ),
  );

  const nextStep = any(
    (p) => p.signals!.hasConsultationLanguage || p.signals!.hasBookingLink,
  );
  add(
    "consultation-next-step",
    "contact",
    "An explicit consultation or enquiry invitation",
    8,
    nextStep,
    nextStep === 100
      ? "Consultation, appointment or enquiry language was detected on an inspected page."
      : nextStep === 0
        ? "The scanner did not find an explicit consultation or enquiry invitation."
        : unknown,
    inspected.map((p) =>
      evidenceFor(
        p,
        `Consultation/enquiry invitation: ${p.signals!.hasConsultationLanguage ? "detected" : "not detected"}; booking link: ${p.signals!.hasBookingLink ? "detected" : "not detected"}.`,
      ),
    ),
    action(
      "Explain the first step for a prospective client",
      "An explicit invitation helps visitors understand what to do and what happens next.",
      [
        "Use an accurate invitation such as request a consultation.",
        "Explain what the first conversation covers, any fee and expected response time.",
        "Have someone unfamiliar with the site find and explain that next step.",
      ],
    ),
    "This is an English-language phrase check, not an assessment of persuasion or conversion. Other wording or languages may be missed.",
  );

  const service = any(
    (p) => p.kind === "services" || p.signals!.hasServiceLanguage,
  );
  add(
    "service-information",
    "clarity",
    "Service information in the inspected pages",
    8,
    service,
    service === 100
      ? "A services page or recognizable practice-area wording appeared in the inspected HTML."
      : service === 0
        ? "A services page or recognizable practice-area description was not found within the scan."
        : unknown,
    inspected.map((p) =>
      evidenceFor(
        p,
        `Page category: ${p.kind}; practice-area/services wording: ${p.signals!.hasServiceLanguage ? "detected" : "not detected"}.`,
      ),
    ),
    action(
      "State who you help and what you handle",
      "Prospective clients need enough detail to decide whether their situation fits your practice.",
      [
        "Name your actual practice areas in plain language.",
        "Link the homepage to a useful services page.",
        "Explain who each service is for and how to begin.",
      ],
    ),
    "Navigation and English-language wording are signals of availability. They do not establish copy quality, expertise or legal eligibility.",
  );

  const people = any((p) => p.kind === "about" || p.signals!.hasPeopleLanguage);
  add(
    "people-information",
    "clarity",
    "Information about the people behind the practice",
    5,
    people,
    people === 100
      ? "An about/team page or attorney-profile wording was detected."
      : people === 0
        ? "About/team information was not detected within the inspected pages."
        : unknown,
    inspected.map((p) =>
      evidenceFor(
        p,
        `About/team page: ${p.kind === "about" ? "yes" : "no"}; attorney-profile wording: ${p.signals!.hasPeopleLanguage ? "detected" : "not detected"}.`,
      ),
    ),
    action(
      "Help visitors understand who will help them",
      "A current, accurate professional profile gives prospective clients useful context.",
      [
        "Add or update your attorney profile and relevant experience.",
        "Link it from the main navigation.",
        "Keep any professional claims accurate and review applicable advertising rules.",
      ],
    ),
    "The scanner does not verify licensing, credentials, experience or advertising compliance.",
  );

  const location = any((p) => p.signals!.hasLocationLanguage);
  add(
    "location-information",
    "clarity",
    "Location or service-area information",
    4,
    location,
    location === 100
      ? "Address markup or location/service-area language was detected."
      : location === 0
        ? "The scanner did not identify location or service-area information."
        : unknown,
    inspected.map((p) =>
      evidenceFor(
        p,
        `Location/address/service-area signal: ${p.signals!.hasLocationLanguage ? "detected" : "not detected"}.`,
      ),
    ),
    action(
      "Clarify where you serve clients",
      "Visitors need to know whether your practice can help in their location.",
      [
        "Describe the locations or jurisdictions you actually serve.",
        "Explain remote consultations if available.",
        "Review the wording for accuracy and applicable professional rules.",
      ],
    ),
    "Detected text is not verification of jurisdiction, licensing or a physical office.",
  );

  const meta = readable.length
    ? Math.round(
        (readable.reduce(
          (n, p) =>
            n + (p.signals!.title ? 1 : 0) + (p.signals!.description ? 1 : 0),
          0,
        ) /
          (readable.length * 2)) *
          100,
      )
    : null;
  add(
    "page-metadata",
    "search",
    "Page titles and descriptions",
    8,
    meta,
    meta === null
      ? unknown
      : `${readable.filter((p) => p.signals!.title).length} of ${readable.length} readable pages have a title; ${readable.filter((p) => p.signals!.description).length} have a meta description.`,
    readable.map((p) =>
      evidenceFor(
        p,
        `Title: ${p.signals!.title ? "present" : "missing"}; meta description: ${p.signals!.description ? "present" : "missing"}.`,
      ),
    ),
    action(
      "Give important pages useful titles and descriptions",
      "Accurate page metadata helps visitors and search systems understand each page.",
      [
        "Write an accurate title for each important page.",
        "Add a concise description of what that page offers.",
        "Check that titles and descriptions are distinct and match visible content.",
      ],
    ),
  );

  const index =
    home && !home.signals!.likelyJavascriptShell
      ? home.signals!.noindex
        ? 0
        : 100
      : null;
  add(
    "index-directive",
    "search",
    "Homepage indexing directive",
    6,
    index,
    index === 100
      ? "No noindex directive was detected in the homepage HTML or response headers."
      : index === 0
        ? "A noindex directive was detected on the homepage."
        : unknown,
    home
      ? [
          evidenceFor(
            home,
            `noindex directive: ${home.signals!.noindex ? "detected" : "not detected"}.`,
          ),
        ]
      : [],
    action(
      "Review whether your homepage should be indexable",
      "An unintended noindex directive can keep a public marketing homepage out of search results.",
      [
        "Confirm whether excluding this homepage from search is intentional.",
        "If it should be searchable, remove the noindex directive in the CMS or host settings.",
        "Check Search Console after publishing.",
      ],
    ),
    "No detected noindex directive does not prove indexing, search ranking, sitemap coverage or crawl access for another crawler.",
  );

  const headings = fraction((p) => p.signals!.h1Count > 0);
  add(
    "page-heading",
    "clarity",
    "Main headings on inspected pages",
    4,
    headings,
    headings === null
      ? unknown
      : `${readable.filter((p) => p.signals!.h1Count > 0).length} of ${readable.length} readable pages include an H1 heading.`,
    readable.map((p) =>
      evidenceFor(p, `H1 heading count: ${p.signals!.h1Count}.`),
    ),
    action(
      "Give each important page a clear main heading",
      "A visible main heading helps people orient themselves and supports page structure.",
      [
        "Use a meaningful H1 heading that describes the page.",
        "Check that it matches the page's main purpose.",
        "Review the page with your website's accessibility tools.",
      ],
    ),
    "Heading presence does not establish clarity or a correct overall heading hierarchy.",
  );

  const viewport = home
    ? home.signals!.hasViewport
      ? 100
      : home.signals!.likelyJavascriptShell
        ? null
        : 0
    : null;
  add(
    "mobile-viewport",
    "mobile",
    "Mobile viewport declaration",
    5,
    viewport,
    viewport === 100
      ? "A device-width viewport declaration was found on the homepage."
      : viewport === 0
        ? "A device-width viewport declaration was not detected on the homepage."
        : unknown,
    home
      ? [
          evidenceFor(
            home,
            `device-width viewport: ${home.signals!.hasViewport ? "detected" : "not detected"}.`,
          ),
        ]
      : [],
    action(
      "Check your mobile layout settings",
      "A device-width viewport is a basic building block for a usable mobile page.",
      [
        "Ask your developer or theme provider to add the correct viewport meta tag.",
        "Check the page on a real phone for clipping, readable text and usable buttons.",
        "Run a mobile audit again after updating.",
      ],
    ),
    "This HTML check does not establish that the layout works on mobile devices.",
  );

  const images = readable.reduce((n, p) => n + p.signals!.imageCount, 0);
  const missingAlt = readable.reduce(
    (n, p) => n + p.signals!.imagesMissingAlt,
    0,
  );
  add(
    "image-alt",
    "accessibility",
    "Image alternative-text attributes",
    4,
    images ? Math.round(((images - missingAlt) / images) * 100) : null,
    images
      ? `${missingAlt} of ${images} image elements lack an alt attribute.`
      : "No image elements were available for this check; no penalty applies.",
    readable
      .filter((p) => p.signals!.imageCount > 0)
      .map((p) =>
        evidenceFor(
          p,
          `${p.signals!.imagesMissingAlt} of ${p.signals!.imageCount} image elements lack an alt attribute.`,
        ),
      ),
    action(
      "Review image alternative text",
      "Useful alternative text helps people who cannot see an informative image.",
      [
        "Add meaningful alt text to informative images.",
        "Use an empty alt attribute for purely decorative images.",
        "Have a person review whether the descriptions convey the intended information.",
      ],
    ),
    "The scanner checks attribute presence, not whether alternative text is meaningful. An empty alt attribute can be correct for decoration.",
  );

  const controls = readable.reduce(
    (n, p) => n + p.signals!.formControlCount,
    0,
  );
  const unlabeled = readable.reduce(
    (n, p) => n + p.signals!.unlabeledFormControlCount,
    0,
  );
  add(
    "form-labels",
    "accessibility",
    "Labels for form controls",
    4,
    controls ? Math.round(((controls - unlabeled) / controls) * 100) : null,
    controls
      ? `${unlabeled} of ${controls} inspected form controls lack a detectable label.`
      : "No relevant form controls were available for this check; no penalty applies.",
    readable
      .filter((p) => p.signals!.formControlCount > 0)
      .map((p) =>
        evidenceFor(
          p,
          `${p.signals!.unlabeledFormControlCount} of ${p.signals!.formControlCount} controls lack a detectable label.`,
        ),
      ),
    action(
      "Give every form field an accessible label",
      "Clear field labels help people understand and complete an enquiry form.",
      [
        "Associate a visible label with each form field.",
        "Check the form with keyboard navigation and an accessibility tool.",
        "Send a test enquiry yourself; this scanner submits nothing.",
      ],
    ),
    "This is a limited static label check, not a full accessibility or form-function test.",
  );

  for (const [key, id, category, title, weight] of [
    [
      "performance",
      "mobile-performance",
      "mobile",
      "Mobile laboratory performance",
      12,
    ],
    [
      "accessibility",
      "automated-accessibility",
      "accessibility",
      "Automated accessibility audit",
      7,
    ],
  ] as const) {
    const points = performance.categories[key] ?? null;
    const performanceAction =
      key === "performance"
        ? action(
            "Improve the largest mobile performance bottleneck",
            "Faster, more stable pages reduce friction for visitors using phones.",
            performance.opportunities.length
              ? [
                  performance.opportunities[0].title,
                  "Ask your website provider to implement and verify the improvement.",
                  "Repeat the mobile audit and compare the underlying measurements.",
                ]
              : [
                  "Open the page in PageSpeed Insights and review its highest-impact opportunities.",
                  "Ask your website provider to address the largest bottleneck.",
                  "Repeat the mobile audit after publishing.",
                ],
            "medium",
          )
        : action(
            "Review the automated accessibility findings",
            "Automated findings can identify barriers that deserve a closer human review.",
            [
              "Run the page in PageSpeed Insights and inspect the accessibility audit details.",
              "Fix the reported barriers and test with keyboard navigation.",
              "Arrange a broader accessibility review for issues automation cannot assess.",
            ],
            "medium",
          );
    const providerName =
      performance.provider === "vercel-lighthouse"
        ? "Lighthouse in a Vercel sandbox"
        : performance.provider === "google-pagespeed"
          ? "Google PageSpeed Insights (Lighthouse)"
          : "Lighthouse";
    findings.push({
      id,
      category,
      title,
      weight,
      points,
      status:
        points === null ? "unknown" : points >= 90 ? "pass" : "needs_attention",
      summary:
        points === null
          ? (performance.reason ??
            "The mobile laboratory audit did not return this measurement.")
          : `${providerName} mobile ${key} score: ${points}/100.`,
      evidence:
        points === null
          ? []
          : [
              {
                sourceUrl: performance.sourceUrl,
                observedAt: performance.fetchedAt,
                detail: `${providerName} ${performance.lighthouseVersion ?? ""}, mobile strategy, ${key}: ${points}/100.`,
              },
            ],
      method: "lighthouse",
      ...(points !== null && points < 90 ? { action: performanceAction } : {}),
      limitation:
        key === "performance"
          ? "A simulated laboratory run can vary between runs and differs from real-user experience. No claim about Core Web Vitals field data is made."
          : "Automated checks detect only some accessibility issues and do not establish compliance.",
    });
  }

  const scored = findings.filter((f) => f.weight > 0 && f.points !== null);
  const totalWeight = findings.reduce((sum, f) => sum + f.weight, 0);
  const measuredWeight = scored.reduce((sum, f) => sum + f.weight, 0);
  const coverage = totalWeight
    ? Math.round((measuredWeight / totalWeight) * 100)
    : 0;
  const score =
    coverage >= 40 && scored.length >= 4
      ? Math.round(
          scored.reduce((sum, f) => sum + f.weight * f.points!, 0) /
            measuredWeight,
        )
      : null;
  // Order actionable, largest weighted observed gaps first. Unknowns never masquerade as failures.
  findings.sort((a, b) => {
    const priority = (f: WebsiteFinding) =>
      f.status === "needs_attention" ? f.weight * (100 - f.points!) : -1;
    return priority(b) - priority(a);
  });
  return {
    findings,
    score,
    coverage,
    measuredChecks: scored.length,
    totalChecks: findings.filter((f) => f.weight > 0).length,
  };
}
