import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    alias: { '@': import.meta.dirname },
    exclude: [...configDefaults.exclude, 'e2e/**'], // e2e/ belongs to Playwright
  },
})
