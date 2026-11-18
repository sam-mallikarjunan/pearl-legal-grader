import type { Metadata } from "next";
import AccountPanel from "../../components/AccountPanel";

export const metadata: Metadata = {
  title: "Your private workspace | Practice Grader",
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next;
  return (
    <main className="page-width progress-page account-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
          <h1>Your practice workspace</h1>
          <p>Work on your next action and review your progress.</p>
        </div>
      </div>
      <section className="card">
        <AccountPanel nextPath={next === "/admin" ? "/admin" : undefined} />
      </section>
    </main>
  );
}
