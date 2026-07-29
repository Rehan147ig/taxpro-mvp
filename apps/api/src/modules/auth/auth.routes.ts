import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../config/db.js';
import { users } from '../../db/schema/users.js';
import { tenants } from '../../db/schema/tenants.js';
import { signToken } from '../../lib/middleware/auth.js';
import { BadRequestError, UnauthorizedError } from '../../lib/errors.js';
import { eq } from 'drizzle-orm';
import { rateLimitMiddleware } from '../../lib/rate-limiter.js';

export const authRoutes = new Hono();

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

authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, tenantName, tenantSlug } = c.req.valid('json');

  // Check if user exists
  const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length > 0) {
    throw new BadRequestError('User already exists with this email');
  }

  // Create tenant
  const [tenant] = await db.insert(tenants).values({
    name: tenantName,
    slug: tenantSlug,
  }).returning();

  // Create user
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({
    email,
    passwordHash,
    tenantId: tenant.id,
  }).returning();

  const token = signToken({ userId: user.id, tenantId: tenant.id, email: user.email, role: user.role ?? 'admin' });

  return c.json({ token, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }, 201);
});

authRoutes.post('/login', rateLimitMiddleware, zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
  const token = signToken({ userId: user.id, tenantId: user.tenantId, email: user.email, role: user.role ?? 'admin' });

  return c.json({ token, tenant });
});
