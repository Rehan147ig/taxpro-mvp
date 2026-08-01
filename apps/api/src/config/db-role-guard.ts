export function dbUserFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.username ? decodeURIComponent(u.username) : null;
  } catch {
    return null;
  }
}

const SUPERUSER_HINTS = [/^(postgres|root)$/i, /_superuser$/i];

export function isSuperuserLikelyUser(user: string | null): boolean {
  if (!user) return true;
  return SUPERUSER_HINTS.some((re) => re.test(user));
}

export function assertRuntimeDbRole(nodeEnv: string, databaseUrl: string): void {
  if (nodeEnv !== 'production') return;
  const user = dbUserFromUrl(databaseUrl);
  if (isSuperuserLikelyUser(user)) {
    throw new Error(
      'DATABASE_URL must use a non-owner NOBYPASSRLS runtime role (e.g. taxpro_app) in production; ' +
      `found user "${user ?? '(none)'}". Use DATABASE_URL_MIGRATIONS with the schema owner for migrations.`,
    );
  }
}
