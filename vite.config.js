import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build gives dist/index.html: one self-contained file that opens by double-click
export default defineConfig({ base: './', plugins: [viteSingleFile()] });
