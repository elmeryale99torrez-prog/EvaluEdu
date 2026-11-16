import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'npm:@supabase/supabase-js@2': '@supabase/supabase-js',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/fase-c/**/*.fasec.ts'],
  },
})
