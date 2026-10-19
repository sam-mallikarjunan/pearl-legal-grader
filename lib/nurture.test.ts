import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NURTURE_LESSONS, NURTURE_LIMITS, renderNurtureEmail } from "./nurture";

test("four immutable lessons provide useful business education, clear next steps and comparable measurements", () => {
  assert.equal(NURTURE_LESSONS.length, 4);
  assert.deepEqual(
    NURTURE_LESSONS.map((l) => l.step),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(NURTURE_LESSONS.map((l) => l.subject)).size, 4);
  for (const lesson of NURTURE_LESSONS) {
    assert.ok(lesson.action.startsWith("This week:"));
    assert.ok(lesson.measure.length > 100);
    assert.ok(lesson.subject.length <= 50);
  }
  assert.deepEqual(NURTURE_LIMITS, {
    messages: 4,
    day: 50,
    month: 500,
    batch: 20,
    attempts: 4,
  });
});
test("every lesson renders accessible text and HTML, truthful sender, postal footer and one-click unsubscribe", () => {
  for (const step of [1, 2, 3, 4]) {
    const message = renderNurtureEmail({
      step,
      recipient: "OWNER@EXAMPLE.INVALID",
      outboxId: "db877072-b78d-4191-ab7b-ddcf09e10ddd",
      unsubscribeUrl:
        "https://example.invalid/api/nurture/unsubscribe?token=synthetic",
      from: "Pearl <grader@example.invalid>",
      appUrl: "https://example.invalid",
      businessName: "Test <business>",
      postalAddress: "123 Example Ave\nFixture, CA 90000",
    });
    assert.deepEqual(message.to, ["owner@example.invalid"]);
    assert.match(message.html, /<html lang="en" dir="ltr">/);
    assert.match(message.html, /Test &lt;business&gt;/);
    assert.match(message.html, /123 Example Ave<br>Fixture/);
    assert.match(message.text, /Business education, not legal advice/);
    assert.match(message.text, /https:\/\/example.invalid\/account/);
    assert.equal(
      message.headers["List-Unsubscribe"],
      "<https://example.invalid/api/nurture/unsubscribe?token=synthetic>",
    );
    assert.equal(
      message.headers["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click",
    );
    assert.match(message.text, /reading this email/i);
    assert.ok(
      !/tracking|pixel|utm_|<img|score:|client name/i.test(message.html),
    );
  }
});
