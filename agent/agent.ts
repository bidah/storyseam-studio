import { defineAgent } from "eve";
import { modelConfig } from "./lib/model";

// Root production agent. Model wiring (gateway by default, local Ollama when
// OLLAMA_MODEL is set) lives in ./lib/model so the script specialist subagents
// under ./subagents/* — which are isolated and inherit nothing from here — can
// share the exact same config. See agent/subagents/README.md.
export default defineAgent({ ...modelConfig() });
