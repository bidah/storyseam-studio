// Loose (defensive) shapes for what the eve agent streams back. Parts may be
// missing any field, so everything is optional — renderers must null-check.

export type InputRequestOption = {
  id: string;
  label?: string;
  style?: string;
};

export type InputRequest = {
  requestId: string;
  prompt?: string;
  options?: InputRequestOption[];
};

export type InputResponse = {
  optionId?: string;
  text?: string;
};

export type MessagePart = {
  type?: string;
  text?: string;
  state?: string;
  toolName?: string;
  toolCallId?: string;
  toolMetadata?: {
    eve?: {
      inputRequest?: InputRequest;
      inputResponse?: InputResponse;
    };
  };
  // `authorization` parts
  displayName?: string;
  outcome?: string;
  description?: string;
  authorization?: {
    url?: string;
    userCode?: string;
    instructions?: string;
  };
};

export type AgentMessage = {
  id?: string;
  role?: string;
  parts?: MessagePart[];
};

// One image the user sent with a turn (re-rendered from the persisted,
// ordinal-aligned attachments record — eve doesn't echo image parts back).
export type SentAttachment = {
  url: string;
  name?: string;
  contentType?: string;
};
