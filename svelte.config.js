import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('svelte/compiler').Config} */
const config = {
  preprocess: vitePreprocess(),
};

export default config;
