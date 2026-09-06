export function resolveConversationId(
  availableIds: string[],
  requestedId: string | null | undefined,
): string {
  if (requestedId && availableIds.includes(requestedId)) return requestedId;
  return availableIds[0] ?? "";
}

export function conversationUrl(currentUrl: string, conversationId: string): string {
  const url = new URL(currentUrl);
  if (conversationId) url.searchParams.set("conversation", conversationId);
  else url.searchParams.delete("conversation");
  return `${url.pathname}${url.search}${url.hash}`;
}
