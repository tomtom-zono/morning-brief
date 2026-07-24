import { defineConfig } from 'astro/config';

export default defineConfig({
  // 完全静的生成。Cloudflare Pages / GitHub Pages のどちらでも配信できる(仕様4.1)
  output: 'static',
  build: { format: 'directory' },
  // 記事本文は生成物であり、Astro のデフォルト最適化のみで足りる
  devToolbar: { enabled: false },
});
