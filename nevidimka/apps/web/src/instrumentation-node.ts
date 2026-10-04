import { validateRuntimeEnvironment } from "@nevidimka/shared-types";
import { verifyDatabaseRoles } from "@nevidimka/db";

export async function registerNodeRuntime(): Promise<void> {
  validateRuntimeEnvironment("web");
  await verifyDatabaseRoles();
}
