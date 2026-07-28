// Escapes a value on its way INTO ews-javascript-api.
//
// The installed library builds its SOAP request by string concatenation and
// does NOT escape the values it is given — EwsServiceXmlWriter.WriteValue is
// literally `this.soapData += value`, with a standing `//todo: validate invalid
// characters` beside it (ews-javascript-api 0.15.3, verified in
// node_modules on 28.07.2026).
//
// Measured on the wire the same day, this is not theoretical. An HTML body left
// the process as:
//
//   <t:Body BodyType="HTML"><div dir="rtl">…</div></t:Body>
//
// The markup parsed as XML child elements rather than as the element's text, so
// Exchange stored an EMPTY body — and answered `Success / NoError`. A callback
// appointment reached the owner's calendar with no number to dial and no link,
// and nothing anywhere reported a failure. The only reason this went unnoticed
// for a day is that the previous body format was plain text with no angle
// bracket in it, so it happened to survive the same broken path.
//
// The same defect is waiting on every other string: a subject or location
// containing `&` ("דנה & יוסי") produces malformed XML, and a guest-supplied
// note is attacker-influenced text being concatenated into a SOAP envelope.
// Escaping therefore happens HERE, at the single boundary where our data
// crosses into the library, rather than at each call site.
//
// Only the three characters that are special in XML *element text* are escaped;
// quotes matter in attribute values, and no value we send is written as an
// attribute. If the library ever starts escaping on its own, this becomes
// double-escaping and must be removed together with that upgrade — hence the
// version pinned above.
export function xmlSafe(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
