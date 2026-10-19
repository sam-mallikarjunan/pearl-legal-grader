import Link from "next/link";
export const metadata = {
  title: "Outcome-reporting reminders stopped | Pearl",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <main className="container" style={{ maxWidth: 640, padding: "64px 24px" }}>
      <h1>Outcome-reporting reminders stopped</h1>
      <p>
        Only these reporting reminders are stopped. Other email preferences,
        research permissions and your grade stay unchanged. Already accepted
        email may still arrive.
      </p>
      <Link href="/account">Open your account</Link>
    </main>
  );
}
