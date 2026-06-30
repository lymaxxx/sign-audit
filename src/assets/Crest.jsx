export default function Crest({ size = 200 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 220"
      role="img"
      aria-label="Escudo del Club Atlético de Riachuelo"
    >
      <defs>
        <clipPath id="shieldClip">
          <path d="M100 6 L186 28 V108 C186 158 148 196 100 214 C52 196 14 158 14 108 V28 Z" />
        </clipPath>
      </defs>

      <path
        d="M100 6 L186 28 V108 C186 158 148 196 100 214 C52 196 14 158 14 108 V28 Z"
        fill="var(--teal)"
        stroke="var(--teal-deep)"
        strokeWidth="4"
      />

      <g clipPath="url(#shieldClip)" opacity="0.18">
        <circle cx="60" cy="60" r="26" fill="none" stroke="var(--cream)" strokeWidth="4" />
        <circle cx="140" cy="70" r="34" fill="none" stroke="var(--cream)" strokeWidth="4" />
        <circle cx="70" cy="150" r="20" fill="none" stroke="var(--cream)" strokeWidth="4" />
        <circle cx="120" cy="160" r="14" fill="none" stroke="var(--cream)" strokeWidth="4" />
      </g>

      <g transform="translate(38,38)">
        <path
          d="M30 10 C10 18 4 36 14 50 C20 58 30 60 36 56 L36 70 C36 80 30 88 22 92 L8 96"
          fill="none"
          stroke="var(--rust-red)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M34 8 L86 2 L52 26 Z"
          fill="var(--rust-red)"
          stroke="var(--rust-red-deep)"
          strokeWidth="2"
        />
        <circle cx="30" cy="16" r="4" fill="var(--signal-green)" />
      </g>

      <path
        d="M100 6 L186 28 V108 C186 158 148 196 100 214 C52 196 14 158 14 108 V28 Z"
        fill="none"
        stroke="var(--teal-deep)"
        strokeWidth="4"
      />

      <rect x="14" y="150" width="172" height="36" fill="var(--cream)" stroke="var(--teal-deep)" strokeWidth="3" />
      <text x="100" y="166" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="13" fontWeight="600" fill="var(--teal-deep)">
        CLUB ATLETICO
      </text>
      <text x="100" y="180" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="13" fontWeight="600" fill="var(--teal-deep)">
        DE RIACHUELO
      </text>
    </svg>
  );
}
