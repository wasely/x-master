/** @type {import('next').NextConfig} */
const nextConfig = {
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
