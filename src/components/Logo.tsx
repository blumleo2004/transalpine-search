export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="32,10 46,50 18,50" fill="#f5f6f0" />
      <polygon points="20,26 30,50 10,50" fill="#f5f6f0" opacity="0.75" />
      <polygon points="44,26 54,50 34,50" fill="#f5f6f0" opacity="0.75" />
      <polygon points="32,8 36,18 32,15 28,18" fill="#e2673a" />
    </svg>
  );
}
