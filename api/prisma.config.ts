import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // env() throws at config load when unset, which breaks `prisma generate`
    // during builds where DATABASE_URL is only present at runtime.
    url: process.env.DATABASE_URL ?? '',
  },
})