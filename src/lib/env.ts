export function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}
export const bool = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').toLowerCase());
export const defaultCountry = () => env('DEFAULT_COUNTRY', 'CL').toUpperCase();
export const extraCountries = () =>
  env('EXTRA_COUNTRIES', 'CO').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
