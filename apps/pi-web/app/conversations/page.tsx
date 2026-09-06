import { ConversationShell } from "@/components/ConversationShell";
import { I18nProvider } from "@/hooks/useI18n";

export default function ConversationsPage() {
  return <I18nProvider><ConversationShell /></I18nProvider>;
}
