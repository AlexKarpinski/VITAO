const FULL_SHA = /^[0-9a-f]{40}$/;

export type ReviewRequestComment = {
  author: string;
  body: string;
};

export type ReviewRequestDecisionInput = {
  currentHeadSha: string;
  ciSha: string;
  ciGreen: boolean;
  isDraft: boolean;
  trustedAuthors: readonly string[];
  comments: readonly ReviewRequestComment[];
};

export type ReviewRequestDecision =
  | { shouldRequest: true; marker: string }
  | {
      shouldRequest: false;
      reason: 'invalid-head-sha' | 'draft' | 'ci-not-green' | 'ci-sha-mismatch' | 'already-requested';
    };

export function reviewRequestMarker(headSha: string): string {
  return `<!-- codex-review-requested:${headSha} -->`;
}

export function decideCodexReviewRequest(input: ReviewRequestDecisionInput): ReviewRequestDecision {
  if (!FULL_SHA.test(input.currentHeadSha)) {
    return { shouldRequest: false, reason: 'invalid-head-sha' };
  }

  if (input.isDraft) {
    return { shouldRequest: false, reason: 'draft' };
  }

  if (!input.ciGreen) {
    return { shouldRequest: false, reason: 'ci-not-green' };
  }

  if (input.ciSha !== input.currentHeadSha) {
    return { shouldRequest: false, reason: 'ci-sha-mismatch' };
  }

  const marker = reviewRequestMarker(input.currentHeadSha);
  const trustedAuthors = new Set(input.trustedAuthors);
  const alreadyRequested = input.comments.some(
    (comment) =>
      trustedAuthors.has(comment.author) &&
      comment.body.includes('@codex review') &&
      comment.body.includes(marker),
  );

  if (alreadyRequested) {
    return { shouldRequest: false, reason: 'already-requested' };
  }

  return { shouldRequest: true, marker };
}
