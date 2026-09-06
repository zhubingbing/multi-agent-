import { ConversationShell } from "@/components/ConversationShell";
import { I18nProvider } from "@/hooks/useI18n";

export default function GroupPage() {
  return <I18nProvider><ConversationShell diagnostic /></I18nProvider>;
}
