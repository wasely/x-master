const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  experimental: {
    serverComponentsExternalPackages: [
      "chromadb",
      "@chroma-core/default-embed",
      "@huggingface/transformers",
      "onnxruntime-node",
    ],
  },
};

export default nextConfig;
