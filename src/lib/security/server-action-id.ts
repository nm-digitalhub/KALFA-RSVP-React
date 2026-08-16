// Whether a `next-action` header value could possibly name a Server Action in
// THIS build — the cheap shape check the proxy runs before handing a request to
// Next's action pipeline.
//
// This deliberately mirrors Next's own gate rather than inventing a stricter
// one. In next/dist/shared/lib/server-reference-info.js:
//
//   const SERVER_REFERENCE_ID_LENGTH = 42;
//   function mightBeServerReferenceId(id) {
//     return id.length === SERVER_REFERENCE_ID_LENGTH;
//   }
//
// A Next 16 id is 42 characters: a two-hex-digit info byte encoding the
// reference type and which arguments the function actually uses, followed by a
// 40-character hash. The pre-16 format was the bare 40-character hash, which is
// why ids of that length show up at all.
//
// LENGTH ONLY, matching Next exactly — no charset or hex assertion. Being
// stricter than the framework on a path real users take is how you reject a
// legitimate action for a format detail that changes in a minor release. The
// ids we are turning away are 1-6 characters or 40; none of them survive a
// length check, so a tighter rule buys nothing and risks something.
const SERVER_REFERENCE_ID_LENGTH = 42;

export function isPlausibleServerActionId(id: string): boolean {
  return id.length === SERVER_REFERENCE_ID_LENGTH;
}
