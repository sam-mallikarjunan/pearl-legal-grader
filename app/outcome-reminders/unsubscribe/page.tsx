import Link from "next/link";
export const metadata = {
  title: "Stop outcome-reporting reminders | Pearl",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const p = await searchParams;
  const token =
    typeof p.token === "string" && p.token.length <= 250 ? p.token : "";
  return (
    <main className="container" style={{ maxWidth: 640, padding: "64px 24px" }}>
      <h1>Stop outcome-reporting reminders</h1>
      <p>
        This stops only reminders to record your planned business periods. Other
        email preferences, research permissions and your grade stay the same.
        Email already accepted for delivery may still arrive.
      </p>
      {token ? (
        <form
          method="post"
          action={`/api/outcome-reminders/unsubscribe?token=${encodeURIComponent(token)}`}
        >
          <input type="hidden" name="List-Unsubscribe" value="One-Click" />
          <button className="btn btn-primary" type="submit">
            Stop outcome-reporting reminders
          </button>
        </form>
      ) : (
        <p>
          This link is incomplete. You can also stop these reminders in your
          signed-in account.
        </p>
      )}
      <p>
        <Link href="/account">Open your account</Link>
      </p>
    </main>
  );
}
