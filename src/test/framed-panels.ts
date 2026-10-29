// The framed panels in rendered markup: a container (section, div, fieldset, form, list) that draws a full border with
// rounded corners. A setup step lives in the setup shell's one content surface (design D3), so a step that renders one
// of these nests a frame inside a frame. A status notice (a `p`) is not a container and is not counted; a top divider
// (`border-t`) is a section separator, not a frame.
const CONTAINER_TAG = /<(section|div|fieldset|form|ul|ol)\b[^>]*>/g;

export function framedPanels(html: string): string[] {
  return (html.match(CONTAINER_TAG) ?? []).filter((tag) => {
    const classes = (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/);
    return classes.includes('border') && classes.some((c) => /^rounded(-|$)/.test(c));
  });
}
