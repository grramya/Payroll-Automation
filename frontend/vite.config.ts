import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Forward cookies in dev so the httpOnly auth cookie round-trips correctly
        cookieDomainRewrite: 'localhost',
      },
    },
  },

  build: {
    // Warn on chunks larger than 600 KB (default is 500 KB)
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor runtime — cached across all pages
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui':      ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          'vendor-grid':     ['ag-grid-community', 'ag-grid-react'],
          'vendor-charts':   ['recharts'],
          'vendor-datepick': ['@mui/x-date-pickers', 'dayjs'],
          // Feature chunks — downloaded only when the user visits that section
          'chunk-fpa':    [
            './src/pages/fpa/GeneratePage',
            './src/pages/fpa/DashboardPage',
            './src/pages/fpa/StagingPage',
            './src/pages/fpa/BaseBSPage',
            './src/pages/fpa/BSIndividualPage',
            './src/pages/fpa/PLIndividualPage',
            './src/pages/fpa/ComparativePLPage',
            './src/pages/fpa/ComparativePLBDPage',
            './src/pages/fpa/MappingPage',
          ],
          'chunk-portco': ['./src/pages/portco/index'],
          'chunk-chat':   ['./src/components/chat/ChatWidget'],
        },
      },
    },
  },
})
