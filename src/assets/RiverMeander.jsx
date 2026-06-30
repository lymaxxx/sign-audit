export default function RiverMeander({ className = '' }) {
  return (
    <svg
      className={`river-meander ${className}`}
      viewBox="0 0 600 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0 12 C50 0 100 24 150 12 C200 0 250 24 300 12 C350 0 400 24 450 12 C500 0 550 24 600 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
    </svg>
  );
}
