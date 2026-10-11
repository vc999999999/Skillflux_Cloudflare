import type { UpdateCheckItem, UpdateCheckResult } from './runtime/model.js';
import type { SkillFluxRuntime } from './runtime/runtime.js';

/** Session-only delivery. Runtime remains the sole owner of version decisions. */
export class StartupUpdates {
  private started = false;
  private closed = false;
  private consumed = false;
  private readonly controller = new AbortController();
  private readonly covered = new Set<string>();
  private readonly reportedLive = new Map<string, number>();
  private pending?: UpdateCheckResult;

  constructor(
    private readonly runtime: Pick<SkillFluxRuntime, 'checkUpdates' | 'list'>,
    private readonly notify: (count: number) => Promise<void>,
  ) {}

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    // Never delay the MCP handshake or a foreground tool on this network request.
    void this.runtime.checkUpdates(undefined, true, this.controller.signal).then(async result => {
      if (this.closed) return;
      this.pending = result;
      if (await this.isCurrent() && !this.closed && !this.consumed) {
        const count = this.remaining().length;
        if (count) await this.notify(count);
      }
    }).catch(() => {
      // Startup delivery is best effort; explicit checks retain their own errors.
    });
  }

  close(): void {
    this.closed = true;
    this.pending = undefined;
    this.controller.abort();
  }

  /** Suppress the same result, never a newer live result for the same skill. */
  cover(items: UpdateCheckItem[]): void {
    if (this.closed || this.consumed) return;
    for (const item of items) {
      this.covered.add(resultKey(item));
      // Remember live results even when an older background result arrives late.
      if (item.source === 'catalog' && item.checkedAt) {
        const checkedAt = Date.parse(item.checkedAt);
        if (Number.isFinite(checkedAt)) this.reportedLive.set(item.id, Math.max(this.reportedLive.get(item.id) ?? 0, checkedAt));
      }
    }
  }

  async takeNotice(): Promise<string | undefined> {
    if (this.closed || this.consumed || !this.pending) return;
    try {
      if (!await this.isCurrent() || this.closed || this.consumed) return;
      // No await between reservation and consumption: concurrent tools cannot repeat it.
      this.consumed = true;
      const items = this.remaining();
      if (!items.length) return;
      return [
        'SkillFlux startup update check (read-only; no skills were installed):',
        ...items.map(item => `${item.id}@${item.currentVersion}: status=${item.status}; latest=${item.latestVersion ?? 'unknown'}; latest compatible=${item.latestCompatibleVersion ?? 'unknown'}; pinned=${item.pinned}; source=${item.source}.${item.notes ? ` ${item.notes}` : ''}`),
        'Report this notice once. Unknown means the latest version could not be confirmed. Use skillflux.check_updates for details. Manual updates require an exact plan and user approval; the saved follow-compatible policy is applied only when loading a skill. Do not change pins or policy from this notice.',
      ].join('\n');
    } catch {
      return undefined;
    }
  }

  private remaining() {
    return this.pending?.items.filter(item => {
      if (item.status === 'current' || this.covered.has(resultKey(item))) return false;
      const reportedAt = this.reportedLive.get(item.id);
      return reportedAt === undefined || (item.checkedAt !== null && Date.parse(item.checkedAt) > reportedAt);
    }) ?? [];
  }

  private async isCurrent(): Promise<boolean> {
    const result = this.pending;
    if (!result) return false;
    const installed = await this.runtime.list();
    if (installed.revision === result.lockRevision) return true;
    // A foreground mutation supersedes the background snapshot. Never announce it late.
    this.pending = undefined;
    return false;
  }
}

function resultKey(item: UpdateCheckItem): string {
  return JSON.stringify([
    item.id, item.currentVersion, item.latestVersion, item.latestCompatibleVersion,
    item.status, item.pinned, item.compatibility, item.revocationStatus, item.breaking, item.notes,
  ]);
}
