import { listPatterns, renderPattern } from "@/lib/arc-core/core/index.js";
import type { PatternName } from "@/lib/arc-core/core/index.js";

const EXAMPLES: Record<PatternName, { title: string; variables: Readonly<Record<string, string>> }> = {
  persona: {
    title: "Explain API rate limits",
    variables: { role: "a senior technical writer", experience: "ten years documenting APIs", style: "precise and concise", priority: "clarity over breadth", task: "Explain API rate limits to a developer integrating an API for the first time. Include what a 429 response means and how retries should work." },
  },
  few_shot: {
    title: "Classify customer feedback",
    variables: { examples: "Input: The new dashboard saves me an hour every day.\nOutput: positive\n\nInput: The app crashes whenever I upload a file.\nOutput: negative\n\nInput: I opened the settings page.\nOutput: neutral", input: "Classify this feedback as positive, negative, or neutral. Return only the label.\nFeedback: Setup was quick and the instructions were easy to follow." },
  },
  chain_of_thought: {
    title: "Compare hosting options",
    variables: { problem: "A small team needs to host an internal dashboard for 50 employees. Managed hosting costs $40 per month and takes 1 hour per month to maintain. A virtual server costs $15 per month and takes 4 hours per month to maintain. Engineering time costs $60 per hour. Compare total monthly costs, discuss operational tradeoffs, and recommend an option." },
  },
  template_fill: {
    title: "Extract a meeting summary",
    variables: { text: "At Tuesday's launch meeting, the team agreed to release the dashboard on November 12. Maya will finish accessibility testing by November 8. Leo will draft the release notes by November 10. The next check-in has not been scheduled.", template_structure: "Decision:\nRelease date:\nAction items (owner, task, deadline):\nNext check-in:" },
  },
  critique: {
    title: "Improve release notes",
    variables: { task: "Write customer-facing release notes in three bullets using only these changes: CSV exports now retain column order; dashboard filters persist after refresh; keyboard users can open the search dialog with Ctrl+K. Keep each bullet under 20 words and focus on the benefit to the user." },
  },
  guardrail: {
    title: "Answer from a refund policy",
    variables: { role: "customer support assistant", domain: "the refund policy supplied in the question", additional_rules: "Use only the supplied policy. Do not promise exceptions or invent processing times.", question: "Policy: Unused subscriptions can be refunded within 14 days of purchase. Used subscriptions are not refundable.\nI purchased a subscription 10 days ago and have not used it. Can I get a refund?" },
  },
  decomposition: {
    title: "Plan a documentation migration",
    variables: { problem: "Plan a migration of 200 help articles to a new documentation site. Two writers and one engineer have four weeks. Existing links must keep working, every article needs an owner, and the new site must support search. Give a week-by-week plan, assign responsibilities, identify dependencies, and define launch checks." },
  },
  audience_adapt: {
    title: "Explain two-factor authentication",
    variables: { concept: "two-factor authentication and why it helps protect an account even when a password is stolen", audience: "people setting up their first online account, with no technical background", length: "120 words or fewer", include: "A familiar analogy, one example using an authenticator app, and a reminder to save recovery codes.", exclude: "Cryptography jargon, vendor recommendations, and claims that any security measure is perfect." },
  },
  boundary: {
    title: "Keep a support assistant in scope",
    variables: { scope: "questions about this product's CSV export feature, using this documentation: Open Reports, select Export, then choose CSV. Exports include the currently filtered rows and preserve the visible column order.", refusal_message: "I can only help with CSV exports for this product.", user_input: "How do I export just the rows matching my current filters, keeping the columns in the order I see?" },
  },
};

/** Complete, copyable prompts rendered through the same strict catalog as Optimize. */
export const PATTERN_EXAMPLES = listPatterns().map((pattern) => {
  const example = EXAMPLES[pattern.name as PatternName];
  return { pattern: pattern.name, displayName: pattern.displayName, description: pattern.description, title: example.title, prompt: renderPattern(pattern.name, example.variables).text };
});

export function getPatternExample(name: string) {
  return PATTERN_EXAMPLES.find((example) => example.pattern === name);
}
