export class ActiveRunBinding {
  private runId = "";

  get current(): string {
    return this.runId;
  }

  begin(runId: string): void {
    if (!runId) throw new Error("runId is required");
    if (this.runId) throw new Error("session is streaming; use steer or followUp");
    this.runId = runId;
  }

  finish(runId: string): void {
    if (runId && this.runId === runId) this.runId = "";
  }
}
