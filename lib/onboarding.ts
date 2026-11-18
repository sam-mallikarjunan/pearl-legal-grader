/** Device-local tour choices only. No assessment, account, or analytics data. */
export const ONBOARDING_STORAGE_KEY = "pearl.practice-grader.onboarding.v1";
export const ONBOARDING_RESET_EVENT = "grader:onboarding-preferences-reset";
export type TourChoice = "dismissed" | "completed";
// Only used after a failed browser-storage write; never shared with a server request.
let visitChoices: Record<string, TourChoice> = Object.create(null);
export interface OnboardingPreferences {
  version: 1;
  tours: Record<string, TourChoice>;
}
const validId = (value: string) =>
  /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);
export function parseOnboardingPreferences(
  raw: string | null,
): OnboardingPreferences | null {
  if (raw === null) return { version: 1, tours: {} };
  if (raw.length > 8192) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const record = data as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => !["version", "tours"].includes(key)) ||
      record.version !== 1 ||
      !record.tours ||
      typeof record.tours !== "object" ||
      Array.isArray(record.tours)
    )
      return null;
    const entries = Object.entries(record.tours);
    if (
      entries.length > 30 ||
      entries.some(
        ([id, choice]) =>
          !validId(id) ||
          !["dismissed", "completed"].includes(choice as string),
      )
    )
      return null;
    return {
      version: 1,
      tours: Object.fromEntries(entries) as Record<string, TourChoice>,
    };
  } catch {
    return null;
  }
}
export function readTourChoice(tourId: string): TourChoice | undefined {
  if (typeof window === "undefined" || !validId(tourId)) return;
  try {
    return (
      parseOnboardingPreferences(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY),
      )?.tours[tourId] ?? visitChoices[tourId]
    );
  } catch {
    return visitChoices[tourId];
  }
}
/** Preserve an unreadable or newer record; the choice still works for this visit. */
export function saveTourChoice(tourId: string, choice: TourChoice): boolean {
  if (
    typeof window === "undefined" ||
    !validId(tourId) ||
    !["dismissed", "completed"].includes(choice)
  )
    return false;
  const fallback = () => {
    if (
      Object.hasOwn(visitChoices, tourId) ||
      Object.keys(visitChoices).length < 30
    )
      visitChoices[tourId] = choice;
    window.dispatchEvent(new Event(ONBOARDING_RESET_EVENT));
    return false;
  };
  try {
    const current = parseOnboardingPreferences(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY),
    );
    if (
      !current ||
      (!(tourId in current.tours) && Object.keys(current.tours).length >= 30)
    )
      return fallback();
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tours: { ...current.tours, [tourId]: choice },
      }),
    );
    delete visitChoices[tourId];
    window.dispatchEvent(new Event(ONBOARDING_RESET_EVENT));
    return true;
  } catch {
    return fallback();
  }
}
export function clearOnboardingPreferences(): void {
  if (typeof window === "undefined") return;
  visitChoices = Object.create(null);
  try {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
  window.dispatchEvent(new Event(ONBOARDING_RESET_EVENT));
}
