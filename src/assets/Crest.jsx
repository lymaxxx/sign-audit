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
        stroke="var(--teal-dark)"
        strokeWidth="4"
      />

      <g clipPath="url(#shieldClip)" opacity="0.18">
        <circle cx="60" cy="60" r="26" fill="none" stroke="var(--cream)" strokeWidth="4" />
        <circle cx="140" cy="70" r="34" fill="none" stroke="var(--cream)" strokeWidth="4" />
        <circle cx="70" cy="150" r="20" fill="none" stroke="var(--cream)" strokeWidth="4" />
      </g>

      {/* mechanical heron silhouette */}
      <g transform="translate(38,38)">
        <path
          d="M30 10 C10 18 4 36 14 50 C20 58 30 60 36 56 L36 70 C36 80 30 88 22 92 L8 96"
          fill="none"
          stroke="var(--red)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M34 8 L86 2 L52 26 Z"
          fill="var(--red)"
          stroke="var(--red-dark)"
          strokeWidth="2"
        />
        <circle cx="30" cy="16" r="4" fill="var(--teal-light)" />
      </g>

      <path
        d="M100 6 L186 28 V108 C186 158 148 196 100 214 C52 196 14 158 14 108 V28 Z"
        fill="none"
        stroke="var(--teal-dark)"
        strokeWidth="4"
      />

      <rect x="14" y="150" width="172" height="36" fill="var(--cream)" stroke="var(--teal-dark)" strokeWidth="3" />
      <text
        x="100"
        y="166"
        textAnchor="middle"
        fontFamily="Bebas Neue, sans-serif"
        fontSize="13"
        fill="var(--teal-dark)"
      >
        CLUB ATLETICO
      </text>
      <text
        x="100"
        y="180"
        textAnchor="middle"
        fontFamily="Bebas Neue, sans-serif"
        fontSize="13"
        fill="var(--teal-dark)"
      >
        DE RIACHUELO
      </text>
    </svg>
  );
}
