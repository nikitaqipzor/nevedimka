import type { VideoAssetStatus } from "@nevidimka/shared-types";

export class AccountDeletionBlockedError extends Error {
  constructor() {
    super("Account deletion is temporarily blocked while video processing is active");
    this.name = "AccountDeletionBlockedError";
  }
}

export function assertAccountDeletionCanProceed(statuses: readonly VideoAssetStatus[]): void {
  if (statuses.some((status) => status === "processing" || status === "rendering")) {
    throw new AccountDeletionBlockedError();
  }
}
