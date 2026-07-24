// Shared contract between the chat-history route (owns conv state + navigation)
// and the two ChatHistoryForm implementations (.ios.tsx native SwiftUI Form,
// .tsx RN fallback). Mirrors the settings-form.types.ts split.
export type ChatHistoryItem = {
  id: string;
  title: string;
  // Compact relative time ("2m" / "3h"), pre-derived by the route.
  subtitle: string;
  active: boolean;
};

export type ChatHistoryFormProps = {
  chats: ChatHistoryItem[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};
