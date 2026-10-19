import Link from "next/link";
export const metadata = {
  title: "Practice Foundations emails stopped | Pearl",
  robots: { index: false, follow: false },
};
export default function UnsubscribedPage() {
  return (
    <main className="container" style={{ maxWidth: 640, padding: "64px 24px" }}>
      <p className="eyebrow">PEARL · PRACTICE FOUNDATIONS</p>
      <h1>Grader marketing emails are stopped</h1>
      <p>
        You will receive no further Practice Foundations messages or grader
        marketing emails. Email already accepted for delivery may still arrive.
        Your dashboard and requested report emails remain available.
      </p>
      <Link href="/account">Return to your dashboard</Link>
    </main>
  );
}
