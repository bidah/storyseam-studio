// "@image1" reference tags — the shared vocabulary between the prompt composers
// (ImageStudio, AgentChat) and whatever reads the serialized prompt (the image
// backend, the studio agent, and the chat-history renderer). A tag always names
// an attached reference image by its ATTACHMENT ORDER: @image1 is the first
// image in the tray, @image2 the second, and so on. The composers renumber tags
// live when references are added/removed, so order and label never drift.

export const REF_TAG_RE = /@image(\d+)\b/g;

export const refTagLabel = (index) => `image${index + 1}`;

// The note prepended to an outbound image-generation prompt when it contains
// tags — tells the model how the tags map onto the attached references.
export function withImageRefNote(text) {
  return (
    "Reference note: tags like @image1 in this prompt refer to the attached " +
    "reference images by their attachment order — @image1 is the first attached " +
    "image, @image2 the second, and so on.\n\n" + text
  );
}

// Split a message into text runs and tag tokens so the chat history can render
// the tags as inline chips: "shot of @image1 here" →
// [{type:"text",…}, {type:"tag",label:"image1"}, {type:"text",…}].
export function splitRefTags(text) {
  const out = [];
  let last = 0;
  const re = new RegExp(REF_TAG_RE.source, "g");
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "tag", label: m[0].slice(1) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}
