import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { db, withTenantContext } from '../../config/db.js';
import { users } from '../../db/schema/users.js';
import { tenants } from '../../db/schema/tenants.js';
import { signToken } from '../../lib/middleware/auth.js';
import { BadRequestError, UnauthorizedError } from '../../lib/errors.js';
import { eq, sql } from 'drizzle-orm';
import { rateLimitMiddleware } from '../../lib/rate-limiter.js';

export const authRoutes = new Hono();

/**
 * Look up a user by email for pre-auth flows (login/register duplicate check).
 *
 * The `users` table SELECT policy is tenant-scoped (`tenant_id =
 * app_current_tenant_id()`), which fails closed when no tenant context is set —
 * exactly the situation at login/registration, before the caller's tenant is
 * known. The runtime role (taxpro_app, NOBYPASSRLS) would see zero rows and
 * authentication could never succeed. This uses the SECURITY DEFINER helper
 * (auth_lookup_function migration, owned by the schema-owner role) so the
 * lookup bypasses RLS for this one purpose only.
 */
interface AuthUserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string | null;
  created_at: Date | null;
}

async function findUserByEmail(email: string): Promise<AuthUserRow | null> {
  const res = await db.execute(sql`
    SELECT id, tenant_id, email, password_hash, role, created_at
    FROM auth_find_user_by_email(${email})
  `);
  return (res.rows[0] as unknown as AuthUserRow | undefined) ?? null;
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantName: z.string().min(1),
  tenantSlug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRoutes.post('/register', rateLimitMiddleware, zValidator('json', registerSchema), async (c) => {
  const { email, password, tenantName, tenantSlug } = c.req.valid('json');

  // Check if user exists (SECURITY DEFINER lookup — RLS fails closed pre-auth)
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new BadRequestError('Registration failed');
  }

  // Create tenant + user inside one tenant-scoped transaction.
  // RLS write policies require app.tenant_id to be set (current_setting throws otherwise).
  const tenantId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await withTenantContext(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: tenantName,
      slug: tenantSlug,
    });

    const [created] = await tx.insert(users).values({
      email,
      passwordHash,
      tenantId,
    }).returning();
    return created;
  });

  const token = signToken({ userId: user.id, tenantId: user.tenantId, email: user.email, role: user.role ?? 'admin' });

  return c.json({ token, tenant: { id: user.tenantId, name: tenantName, slug: tenantSlug } }, 201);
});

authRoutes.post('/login', rateLimitMiddleware, zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const user = await findUserByEmail(email);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, user.tenant_id)).limit(1);
  const token = signToken({ userId: user.id, tenantId: user.tenant_id, email: user.email, role: user.role ?? 'admin' });

  return c.json({ token, tenant });
});
