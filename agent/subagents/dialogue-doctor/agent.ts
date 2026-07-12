import { defineAgent } from "eve";
import { modelConfig } from "../../lib/model";

// Script specialist: the dialogue doctor. Advisor pattern — it reviews and
// rewrites lines it is given and returns them; the root applies the changes.
export default defineAgent({
  ...modelConfig(),
  description:
    "Dialogue doctor for the screenplay. Delegate to it to sharpen spoken lines: keep each character's voice consistent, add subtext (say less, imply more), cut on-the-nose exposition, tune rhythm, and punch up flat exchanges. Pass the lines or scene in the message; it returns before/after rewrites with a one-line reason for each. It reviews and rewrites the dialogue it is given — it does not edit the script itself.",
});
