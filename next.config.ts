import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Mark the Node-only modules used by our DB and AI layers as external so
  // Next.js does not try to bundle them into the server runtime. Without
  // this, things like `pg` (which uses native bindings) and `tesseract.js`
  // (which loads worker scripts at runtime) break under bundling.
  serverExternalPackages: ['pg', 'tesseract.js', 'unpdf', '@anthropic-ai/sdk'],
};

export default nextConfig;
