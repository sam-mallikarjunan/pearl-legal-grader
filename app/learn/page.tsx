import type { Metadata } from "next";
import { NURTURE_LESSONS } from "../../lib/nurture";

export const metadata: Metadata = {
  title: "Practice Foundations | Pearl Practice Grader",
  description:
    "Four practical lessons on intake, conversion, cash timing and the operating rhythm of an independent practice.",
};

export default function PracticeFoundationsPage() {
  return (
    <main className="page-width progress-page growth-page">
      <nav className="growth-nav" aria-label="Practice Foundations navigation">
        <a href="/">Return to the grader</a>
        <a href="/benchmarks">Industry benchmarks</a>
        <a href="/account#practice-learning">Get the weekly series</a>
      </nav>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            PRACTICE FOUNDATIONS · FOUR PRACTICAL LESSONS
          </p>
          <h1>Build a practice that works for you.</h1>
          <p>
            Choose one useful change, measure what happens, and keep what helps.
            Read all four lessons here, or request one a week in your private
            workspace. Subscribing never changes your grade.
          </p>
        </div>
      </div>
      <div style={{ display: "grid", gap: 24, maxWidth: 860 }}>
        {NURTURE_LESSONS.map((lesson) => (
          <article
            className="card"
            key={lesson.step}
            style={{ display: "grid", gap: 16 }}
          >
            <p className="eyebrow">LESSON {lesson.step} OF 4</p>
            <h2>{lesson.title}</h2>
            {lesson.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <div className="guide-note">
              <h3>Try one useful change</h3>
              <p>{lesson.action}</p>
            </div>
            <p>
              <strong>What to measure: </strong>
              {lesson.measure}
            </p>
          </article>
        ))}
        <section className="card" style={{ display: "grid", gap: 16 }}>
          <h2>Choose your next step.</h2>
          <p>
            Save a private assessment to track your actions, explore the source
            library, or ask Pearl for help with a business need you choose.
          </p>
          <div className="dialog-data-actions">
            <a className="btn btn-primary" href="/account#practice-learning">
              Get the four-part email series
            </a>
            <a href="/account#request-help">Ask Pearl for help</a>
          </div>
          <p className="fine-print">
            Business education. These lessons do not assess legal skill or
            certify compliance.
          </p>
        </section>
      </div>
    </main>
  );
}
