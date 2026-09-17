import { describe, expect, it } from 'vitest';

import { NO_OAUTH_FAILURE_DETAIL, readOAuthFailureDetail } from './oauth-failure-detail';

// The whole point of this reader is what it REFUSES to return. Every test below
// that starts with ⚠️ is a leak that would otherwise reach a log file.

describe('what it reports', () => {
  it('reports the RFC 6749 error code from a token endpoint refusal', () => {
    // The shape oauth4webapi's ResponseBodyError actually has (index.js:774-778).
    const detail = readOAuthFailureDetail({
      name: 'ResponseBodyError',
      code: 'OAUTH_RESPONSE_BODY_ERROR',
      error: 'invalid_grant',
      error_description: 'AADSTS50011: The redirect URI specified does not match.',
      status: 400,
    });

    expect(detail).toEqual({
      oauthError: 'invalid_grant',
      providerCode: 'AADSTS50011',
      status: 400,
    });
  });

  it('finds the detail through a cause chain, not just at the top', () => {
    // This is the real shape: our IntegrationRuntimeError wraps the library's.
    const detail = readOAuthFailureDetail(
      Object.assign(new Error('The provider did not complete the authorization.'), {
        code: 'integration_authorization_failed',
        classification: 'permanent',
        cause: {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret provided.',
          status: 401,
        },
      }),
    );

    expect(detail.oauthError).toBe('invalid_client');
    expect(detail.providerCode).toBe('AADSTS7000215');
  });

  it('reports the OAuth code alone when the provider named no code of its own', () => {
    const detail = readOAuthFailureDetail({
      error: 'invalid_request',
      error_description: 'Something the provider wrote in prose.',
    });

    expect(detail.oauthError).toBe('invalid_request');
    expect(detail.providerCode).toBeNull();
  });

  it('says nothing about an error that carried nothing', () => {
    expect(readOAuthFailureDetail(new Error('boom'))).toEqual(NO_OAUTH_FAILURE_DETAIL);
    expect(readOAuthFailureDetail(null)).toEqual(NO_OAUTH_FAILURE_DETAIL);
    expect(readOAuthFailureDetail('a string')).toEqual(NO_OAUTH_FAILURE_DETAIL);
    expect(readOAuthFailureDetail(undefined)).toEqual(NO_OAUTH_FAILURE_DETAIL);
  });
});

describe('what it refuses to report', () => {
  it('⚠️ never returns the description — it carries the correlation id and prose', () => {
    // Microsoft's real description includes a correlation id, a timestamp and a
    // trace id. None of it belongs in a log line, and the AADSTS number says
    // everything the description says that is actionable.
    const description =
      'AADSTS50011: The redirect URI does not match. Trace ID: 8a1e-not-a-real-trace ' +
      'Correlation ID: 3f2b-not-a-real-correlation Timestamp: 2026-09-17 06:03:33Z';

    const detail = readOAuthFailureDetail({ error: 'invalid_grant', error_description: description });

    expect(detail.providerCode).toBe('AADSTS50011');
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('Trace');
    expect(serialized).not.toContain('Correlation');
    expect(serialized).not.toContain('not-a-real');
  });

  it('⚠️ refuses an `error` that is not a bare protocol code — the callback URL is public', () => {
    // `AuthorizationResponseError.error` is read straight out of the query
    // string (index.js:793), and ANYONE holding the callback URL can put
    // anything there. Without the charset gate this reader would copy that
    // text into our logs verbatim.
    for (const hostile of [
      'invalid_grant<script>alert(1)</script>',
      'error with spaces',
      'UPPER_CASE_IS_NOT_RFC6749',
      'x'.repeat(200),
      'code\nInjected: log line',
      '{"json":"payload"}',
    ]) {
      expect(readOAuthFailureDetail({ error: hostile }).oauthError).toBeNull();
    }
  });

  it('⚠️ captures only a well-formed AADSTS id, never surrounding text', () => {
    for (const notACode of ['AADSTS', 'AADSTS12', 'AADSTSABCDEFG', 'XAADSTS50011X']) {
      expect(
        readOAuthFailureDetail({ error: 'invalid_grant', error_description: notACode })
          .providerCode,
      ).toBeNull();
    }
  });

  it('⚠️ cannot be walked forever by a self-referencing cause', () => {
    // A cycle here would hang the catch block — i.e. hang the request that is
    // already failing. The depth cap is what makes that impossible.
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;

    expect(readOAuthFailureDetail(cyclic)).toEqual(NO_OAUTH_FAILURE_DETAIL);
  });

  it('⚠️ gives up rather than digging arbitrarily deep', () => {
    // Deeper than the cap: the detail exists but must not be reported, because
    // an unbounded walk is an unbounded amount of work on an error path.
    let nested: unknown = { error: 'invalid_grant' };
    for (let i = 0; i < 10; i += 1) nested = { cause: nested };

    expect(readOAuthFailureDetail(nested).oauthError).toBeNull();
  });
});
