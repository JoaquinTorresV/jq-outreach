/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'exceljs', 'libphonenumber-js'],
  poweredByHeader: false,
  reactStrictMode: true,
};
export default nextConfig;
