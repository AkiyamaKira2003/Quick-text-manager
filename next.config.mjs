import createBundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
  devIndicators: false,
  distDir: process.env.QT_NEXT_DIST_DIR || '.next',
}

export default withBundleAnalyzer(nextConfig)
