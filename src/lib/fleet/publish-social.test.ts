import { describe, expect, it } from 'vitest';

import {
  buildDryRunArtifact,
  buildFacebookFeedRequest,
  buildFacebookPhotoRequest,
  buildInstagramPublishPlan,
  checkReviewApproved,
  classifyGraphApiError,
  decideContainerPoll,
  decideExistingRow,
  deriveDryRunArtifactPath,
  deriveReviewMdPath,
  extractStringId,
  formatGraphApiError,
  IG_CONTAINER_POLL_MAX_ATTEMPTS,
  isPlatform,
  isRetryCeilingReached,
  PUBLISH_RETRY_CEILING,
  scanGroundingClaims,
  sha256Hex,
  validateGrounding,
  validatePlatformImageRequirement,
  validatePublishPayload,
  validatePublishRequestRow,
} from './publish-social';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'publish_social',
    platform: 'facebook',
    attachments: [
      { path: '.fleet-logs/drafts/social/20260810-batch/post-01-caption.txt', label: 'caption', mime: 'text/plain', sha256: 'a'.repeat(64) },
    ],
    ...overrides,
  };
}

describe('isPlatform', () => {
  it('accepts instagram and facebook', () => {
    expect(isPlatform('instagram')).toBe(true);
    expect(isPlatform('facebook')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPlatform('tiktok')).toBe(false);
    expect(isPlatform('')).toBe(false);
  });
});

describe('validatePlatformImageRequirement', () => {
  it('rejects instagram without an image', () => {
    expect(validatePlatformImageRequirement('instagram', false)).toMatch(/image-path/);
  });

  it('accepts instagram with an image', () => {
    expect(validatePlatformImageRequirement('instagram', true)).toBeNull();
  });

  it('accepts facebook with or without an image', () => {
    expect(validatePlatformImageRequirement('facebook', false)).toBeNull();
    expect(validatePlatformImageRequirement('facebook', true)).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('matches a known sha256 digest', () => {
    // sha256("hello") — a fixed, well-known test vector.
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('is deterministic for the same content', () => {
    expect(sha256Hex('same content')).toBe(sha256Hex('same content'));
  });

  it('differs for different content', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});

describe('validatePublishRequestRow', () => {
  it('rejects a missing row', () => {
    expect(validatePublishRequestRow(null)).toMatch(/not found/);
  });

  it('rejects a row from another role', () => {
    const err = validatePublishRequestRow({ role: 'ops-monitor', kind: 'approval', status: 'approved' });
    expect(err).toMatch(/social-manager/);
  });

  it('rejects a non-approval kind', () => {
    const err = validatePublishRequestRow({ role: 'social-manager', kind: 'fyi', status: 'approved' });
    expect(err).toMatch(/approval/);
  });

  it('rejects a still-pending request', () => {
    const err = validatePublishRequestRow({ role: 'social-manager', kind: 'approval', status: 'pending' });
    expect(err).toMatch(/pending/);
  });

  it('rejects a denied request', () => {
    const err = validatePublishRequestRow({ role: 'social-manager', kind: 'approval', status: 'denied' });
    expect(err).not.toBeNull();
  });

  it('accepts an approved request', () => {
    const err = validatePublishRequestRow({ role: 'social-manager', kind: 'approval', status: 'approved' });
    expect(err).toBeNull();
  });
});

describe('validatePublishPayload', () => {
  it('accepts a well-formed matching payload', () => {
    const result = validatePublishPayload(validPayload(), 'facebook');
    expect(result.ok).toBe(true);
  });

  it('rejects a non-publish_social action', () => {
    const result = validatePublishPayload(validPayload({ action: 'something_else' }), 'facebook');
    expect(result.ok).toBe(false);
  });

  it('rejects a platform mismatch between --platform and payload.platform', () => {
    const result = validatePublishPayload(validPayload({ platform: 'instagram' }), 'facebook');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('does not match');
  });

  it('rejects an empty attachments array', () => {
    const result = validatePublishPayload(validPayload({ attachments: [] }), 'facebook');
    expect(result.ok).toBe(false);
  });

  it('gives a specific message when an attachment sha256 is missing (pre-hash-pinning request)', () => {
    const result = validatePublishPayload(
      validPayload({
        attachments: [{ path: 'x', label: 'caption', mime: 'text/plain' }],
      }),
      'facebook',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hash-pinning/);
  });

  it('rejects a malformed (non-hex) sha256', () => {
    const result = validatePublishPayload(
      validPayload({
        attachments: [{ path: 'x', label: 'caption', mime: 'text/plain', sha256: 'not-hex' }],
      }),
      'facebook',
    );
    expect(result.ok).toBe(false);
  });
});

describe('scanGroundingClaims / validateGrounding', () => {
  it('detects currency, percent, free-claims and superlatives', () => {
    expect(scanGroundingClaims('המחיר 200 ₪')).toContain('currency (₪)');
    expect(scanGroundingClaims('הנחה של 50%')).toContain('percent (N%)');
    expect(scanGroundingClaims('הכל בחינם')).toEqual(expect.arrayContaining([expect.stringContaining('free-claim')]));
    expect(scanGroundingClaims('הכי טוב שיש')).toEqual(expect.arrayContaining([expect.stringContaining('superlative')]));
  });

  it('finds nothing in a plain caption', () => {
    expect(scanGroundingClaims('מזל טוב לחתן ולכלה!')).toEqual([]);
  });

  // Regression (measured live, 2026-08-12): a plain .includes() treated "הכי"
  // as a hit inside unrelated words that merely contain it as a substring.
  it('does not treat "הכי" as a false-positive substring inside "הכיתוב" or "הכיסאות"', () => {
    expect(scanGroundingClaims('הכיתוב המלא כטקסט הפוסט, לא על התמונה')).toEqual([]);
    expect(scanGroundingClaims('לשים לב לכיוון הכיסאות באולם')).toEqual([]);
  });

  it('still detects a real standalone "הכי"', () => {
    expect(scanGroundingClaims('הכי טוב שיש')).toEqual(
      expect.arrayContaining([expect.stringContaining('superlative ("הכי")')]),
    );
  });

  // Same substring class of bug, on another word in the scan list — fixed by
  // the same uniform word-boundary check, not a one-off patch for "הכי".
  it('does not treat "תמיד" as a false-positive substring inside "מתמיד"', () => {
    expect(scanGroundingClaims('הצוות שלנו מתמיד במאמץ')).toEqual([]);
  });

  it('still detects a real standalone "תמיד"', () => {
    expect(scanGroundingClaims('אנחנו תמיד כאן בשבילכם')).toEqual(
      expect.arrayContaining([expect.stringContaining('superlative ("תמיד")')]),
    );
  });

  it('requires facts_source when a claim is found', () => {
    expect(validateGrounding('המחיר 200 ₪', undefined)).toMatch(/facts_source/);
    expect(validateGrounding('המחיר 200 ₪', '')).toMatch(/facts_source/);
    expect(validateGrounding('המחיר 200 ₪', '   ')).toMatch(/facts_source/);
  });

  it('passes when facts_source is provided for a claim', () => {
    expect(validateGrounding('המחיר 200 ₪', 'packages table')).toBeNull();
  });

  it('passes a plain caption with no facts_source', () => {
    expect(validateGrounding('מזל טוב לחתן ולכלה!', undefined)).toBeNull();
  });
});

describe('checkReviewApproved', () => {
  it('accepts the exact approved status line', () => {
    expect(checkReviewApproved('סטטוס: מוכנה-לאישור · תאריך: 2026-08-10')).toBe(true);
  });

  it('skips leading blank lines to find the first real line', () => {
    expect(checkReviewApproved('\n\n  סטטוס: מוכנה-לאישור')).toBe(true);
  });

  it('rejects a rejected status', () => {
    expect(checkReviewApproved('סטטוס: נדחתה · תאריך: 2026-08-10')).toBe(false);
  });

  it('rejects a pending-data status', () => {
    expect(checkReviewApproved('סטטוס: ממתינה-לנתון')).toBe(false);
  });

  it('rejects empty content', () => {
    expect(checkReviewApproved('')).toBe(false);
  });
});

describe('deriveReviewMdPath / deriveDryRunArtifactPath', () => {
  it('derives sibling paths from the caption attachment path', () => {
    const captionPath = '.fleet-logs/drafts/social/20260810-batch/post-01-caption.txt';
    expect(deriveReviewMdPath(captionPath)).toBe('.fleet-logs/drafts/social/20260810-batch/REVIEW.md');
    expect(deriveDryRunArtifactPath(captionPath, 'facebook')).toBe(
      '.fleet-logs/drafts/social/20260810-batch/publish-payload-facebook-post-01-caption.json',
    );
    expect(deriveDryRunArtifactPath(captionPath, 'instagram')).toBe(
      '.fleet-logs/drafts/social/20260810-batch/publish-payload-instagram-post-01-caption.json',
    );
  });

  // Regression (measured live, 2026-08-12): two posts in the same batch,
  // published to the same platform, used to derive the IDENTICAL artifact
  // path (dirname + platform only) — the second publish-social run silently
  // overwrote the first post's dry-run artifact.
  it('derives distinct artifact paths for two posts in the same batch and platform', () => {
    const batchDir = '.fleet-logs/drafts/social/20260812-batch';
    const post1Path = deriveDryRunArtifactPath(`${batchDir}/post-1-caption-facebook.txt`, 'facebook');
    const post2Path = deriveDryRunArtifactPath(`${batchDir}/post-2-caption-facebook.txt`, 'facebook');
    expect(post1Path).not.toBe(post2Path);
    expect(post1Path.startsWith(`${batchDir}/`)).toBe(true);
    expect(post2Path.startsWith(`${batchDir}/`)).toBe(true);
  });
});

describe('decideExistingRow', () => {
  it('treats published and publishing as no-op', () => {
    expect(decideExistingRow('published')).toBe('noop');
    expect(decideExistingRow('publishing')).toBe('noop');
  });

  it('treats failed and dry_run as retry-eligible', () => {
    expect(decideExistingRow('failed')).toBe('retry');
    expect(decideExistingRow('dry_run')).toBe('retry');
  });

  it('throws on an unrecognized status (CHECK-constraint violation would be the real bug)', () => {
    expect(() => decideExistingRow('bogus')).toThrow();
  });
});

describe('request builders', () => {
  it('builds a text-only Facebook feed request', () => {
    const req = buildFacebookFeedRequest('מזל טוב!');
    expect(req.method).toBe('POST');
    expect(req.endpoint).toContain('/feed');
    expect(req.body).toEqual({ message: 'מזל טוב!' });
  });

  it('builds a Facebook photo (multipart) request referencing the image path, not embedding bytes', () => {
    const req = buildFacebookPhotoRequest('מזל טוב!', '.fleet-logs/drafts/social/batch/post-01.png');
    expect(req.endpoint).toContain('/photos');
    expect(req.multipart.message).toBe('מזל טוב!');
    expect(req.multipart.source).toContain('post-01.png');
  });

  it('builds a 3-step Instagram plan with a null image_url (no public bucket yet)', () => {
    const plan = buildInstagramPublishPlan('מזל טוב!');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].step).toBe('create_container');
    expect(plan.steps[0].body.image_url).toBeNull();
    expect(plan.steps[1].step).toBe('poll_status');
    expect(plan.steps[2].step).toBe('publish');
  });

  it('uses the graph.instagram.com Route B host (Instagram Login), not graph.facebook.com', () => {
    const plan = buildInstagramPublishPlan('מזל טוב!');
    expect(plan.steps[0].endpoint).toContain('graph.instagram.com');
    expect(plan.steps[1].endpoint).toContain('graph.instagram.com');
    expect(plan.steps[2].endpoint).toContain('graph.instagram.com');
  });

  it('still defaults image_url to null when no URL is given (unchanged behavior)', () => {
    expect(buildInstagramPublishPlan('מזל טוב!').steps[0].body.image_url).toBeNull();
  });

  it('places a resolved signed URL into image_url when provided', () => {
    const plan = buildInstagramPublishPlan(
      'מזל טוב!',
      'https://xyz.supabase.co/storage/v1/object/sign/social-publish-assets/abc.jpg?token=...',
    );
    expect(plan.steps[0].body.image_url).toContain('social-publish-assets');
  });
});

describe('classifyGraphApiError / formatGraphApiError', () => {
  it('classifies both auth error codes (190, 102)', () => {
    expect(classifyGraphApiError({ error: { code: 190, message: 'Session expired' } })).toBe('auth');
    expect(classifyGraphApiError({ error: { code: 102, message: 'API Session' } })).toBe('auth');
  });

  it('classifies rate-limit codes, including the User-token code 32 (Route B Instagram) and the Page-token code 80001 (Facebook)', () => {
    for (const code of [4, 17, 32, 80001, 341, 368, 506, 613]) {
      expect(classifyGraphApiError({ error: { code, message: 'x' } })).toBe('rate_limit');
    }
  });

  it('classifies an unrecognized error code as declined', () => {
    expect(classifyGraphApiError({ error: { code: 100, message: 'Invalid parameter' } })).toBe('declined');
  });

  it('classifies a body with no error key as unknown', () => {
    expect(classifyGraphApiError({})).toBe('unknown');
    expect(classifyGraphApiError(null)).toBe('unknown');
  });

  it('formats a readable message including code/subcode/fbtrace_id', () => {
    const msg = formatGraphApiError(
      { error: { code: 190, error_subcode: 463, message: 'Session expired', fbtrace_id: 'ABC123' } },
      401,
    );
    expect(msg).toContain('190');
    expect(msg).toContain('463');
    expect(msg).toContain('ABC123');
  });
});

describe('decideContainerPoll', () => {
  it('publishes once FINISHED', () => {
    expect(decideContainerPoll('FINISHED', 0)).toEqual({ action: 'publish' });
  });

  it('fails immediately on ERROR/EXPIRED regardless of attempt count', () => {
    expect(decideContainerPoll('ERROR', 0).action).toBe('fail');
    expect(decideContainerPoll('EXPIRED', 0).action).toBe('fail');
  });

  it('waits while still IN_PROGRESS under the attempt ceiling', () => {
    expect(decideContainerPoll('IN_PROGRESS', 0)).toEqual({ action: 'wait' });
  });

  it('fails after the bounded poll ceiling is reached', () => {
    expect(decideContainerPoll('IN_PROGRESS', IG_CONTAINER_POLL_MAX_ATTEMPTS).action).toBe('fail');
  });
});

describe('isRetryCeilingReached', () => {
  it('allows retry below the ceiling', () => {
    expect(isRetryCeilingReached(1)).toBe(false);
  });

  it('blocks retry at and above the ceiling', () => {
    expect(isRetryCeilingReached(PUBLISH_RETRY_CEILING)).toBe(true);
    expect(isRetryCeilingReached(PUBLISH_RETRY_CEILING + 1)).toBe(true);
  });
});

// Regression for a live incident (2026-08-12): a Graph API id read via
// Number(...) silently loses precision past ~15-16 digits. Instagram
// container/media ids are commonly 17 digits.
describe('extractStringId', () => {
  const BIG_IG_ID = '17841400000000123'; // 17 digits — exceeds Number.MAX_SAFE_INTEGER precision

  it('extracts a large (17-digit) id without precision loss', () => {
    expect(extractStringId({ id: BIG_IG_ID }, 'id')).toBe(BIG_IG_ID);
  });

  it('extracts a named field other than "id" (e.g. post_id)', () => {
    expect(extractStringId({ post_id: '123_456' }, 'post_id')).toBe('123_456');
  });

  it('rejects a bare-number id — precision would already be lost upstream', () => {
    expect(extractStringId({ id: 17841400000000123 }, 'id')).toBeNull();
  });

  it('rejects a missing, empty, or malformed field', () => {
    expect(extractStringId({}, 'id')).toBeNull();
    expect(extractStringId(null, 'id')).toBeNull();
    expect(extractStringId(undefined, 'id')).toBeNull();
    expect(extractStringId({ id: '' }, 'id')).toBeNull();
  });
});

describe('buildDryRunArtifact', () => {
  it('builds a feed artifact for facebook with no image', () => {
    const artifact = buildDryRunArtifact('facebook', 'מזל טוב!', null);
    expect(artifact.platform).toBe('facebook');
    expect(artifact.hasImage).toBe(false);
    expect('body' in artifact.request && artifact.request.body).toEqual({ message: 'מזל טוב!' });
  });

  it('builds a photo artifact for facebook with an image', () => {
    const artifact = buildDryRunArtifact('facebook', 'מזל טוב!', '.fleet-logs/drafts/social/batch/img.png');
    expect(artifact.hasImage).toBe(true);
    expect('multipart' in artifact.request).toBe(true);
  });

  it('always marks instagram as hasImage', () => {
    const artifact = buildDryRunArtifact('instagram', 'מזל טוב!', '.fleet-logs/drafts/social/batch/img.png');
    expect(artifact.platform).toBe('instagram');
    expect(artifact.hasImage).toBe(true);
  });
});
