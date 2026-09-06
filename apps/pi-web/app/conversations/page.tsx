import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { I18nProvider } from "@/hooks/useI18n";

export default function ConversationsPage() {
  return <I18nProvider><WorkbenchShell /></I18nProvider>;
}
