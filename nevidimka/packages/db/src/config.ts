export interface DatabaseEnvironment {
  DATABASE_URL?: string;
  SYSTEM_DATABASE_URL?: string;
  NODE_ENV?: string;
}

export interface DatabaseUrls {
  user: string;
  system: string;
}

function databaseCredentialIdentity(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Database connection strings must be valid postgres URLs");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database connection strings must use postgres:// or postgresql://");
  }
  return [url.username, url.password, url.hostname, url.port || "5432", url.pathname].join("\n");
}

export function resolveDatabaseUrls(env: DatabaseEnvironment = process.env): DatabaseUrls {
  const user = env.DATABASE_URL?.trim();
  if (!user) {
    throw new Error("DATABASE_URL is not set");
  }

  databaseCredentialIdentity(user);
  const configuredSystem = env.SYSTEM_DATABASE_URL?.trim();
  if (configuredSystem) databaseCredentialIdentity(configuredSystem);
  if (env.NODE_ENV === "production" && !configuredSystem) {
    throw new Error("SYSTEM_DATABASE_URL is not set");
  }
  if (
    env.NODE_ENV === "production" &&
    configuredSystem &&
    new URL(configuredSystem).username === new URL(user).username
  ) {
    throw new Error("DATABASE_URL and SYSTEM_DATABASE_URL must use different credentials");
  }

  return {
    user,
    system: configuredSystem || user,
  };
}
