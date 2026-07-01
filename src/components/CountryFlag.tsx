type Country = 'CH' | 'AT' | 'DE';

export default function CountryFlag({ country, size = 18 }: { country: Country; size?: number }) {
  const width = size;
  const height = Math.round(size * (country === 'CH' ? 1 : 11 / 16));

  if (country === 'CH') {
    return (
      <svg width={width} height={width} viewBox="0 0 32 32" aria-label="Schweiz">
        <rect width="32" height="32" rx="3" fill="#d52b1e" />
        <rect x="13" y="6" width="6" height="20" fill="#fff" />
        <rect x="6" y="13" width="20" height="6" fill="#fff" />
      </svg>
    );
  }

  if (country === 'AT') {
    return (
      <svg width={width} height={height} viewBox="0 0 16 11" aria-label="Österreich">
        <rect width="16" height="11" fill="#ED2939" />
        <rect y="3.667" width="16" height="3.667" fill="#fff" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} viewBox="0 0 16 11" aria-label="Deutschland">
      <rect width="16" height="3.667" y="0" fill="#000" />
      <rect width="16" height="3.667" y="3.667" fill="#DD0000" />
      <rect width="16" height="3.667" y="7.333" fill="#FFCE00" />
    </svg>
  );
}
