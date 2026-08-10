import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// เผยแพร่บน GitHub Pages ใต้ path /<repo>/ ได้ด้วย  BASE_PATH=/jompol-bourchoom/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
