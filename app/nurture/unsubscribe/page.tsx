import Link from "next/link";
export const metadata = {
  title: "Stop Practice Foundations emails | Pearl",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const value = (await searchParams).token;
  const token = typeof value === "string" && value.length <= 250 ? value : "";
  return (
    <main className="container" style={{ maxWidth: 640, padding: "64px 24px" }}>
      <p className="eyebrow">PEARL · PRACTICE FOUNDATIONS</p>
      <h1>Stop grader marketing emails</h1>
      <p>
        Stop the four-part Practice Foundations series and all grader marketing
        email immediately. You can still sign in and request a report email.
        Email already accepted for delivery may still arrive.
      </p>
      {token ? (
        <form
          method="post"
          action={`/api/nurture/unsubscribe?token=${encodeURIComponent(token)}`}
        >
          <input type="hidden" name="List-Unsubscribe" value="One-Click" />
          <button className="btn btn-primary" type="submit">
            Unsubscribe from grader marketing
          </button>
        </form>
      ) : (
        <p>
          This link is incomplete. You can also stop the series in your
          signed-in dashboard.
        </p>
      )}
      <p>
        <Link href="/account">Open your dashboard</Link>
      </p>
    </main>
  );
}
