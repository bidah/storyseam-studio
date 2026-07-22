// Shared, read-only flow metadata passed to every node without threading it
// through each node's `data` envelope: the resolved Higgsfield model catalogs
// (image + video) and the prompt-preset library. The orchestrator (nodes.jsx)
// provides it; NodeSettingsBar consumes it.
import { createContext, useContext } from "react";

const FlowMetaContext = createContext({ imageModels: [], videoModels: [], prompts: [] });

export function FlowMetaProvider({ value, children }) {
  return <FlowMetaContext.Provider value={value}>{children}</FlowMetaContext.Provider>;
}

export function useFlowMeta() {
  return useContext(FlowMetaContext);
}
