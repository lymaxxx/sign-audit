export default function Lola({ size = 260 }) {
  return (
    <svg
      width={size}
      height={size * 1.5}
      viewBox="0 0 280 420"
      role="img"
      aria-label="Lola la Grúa, mascota del Club Atlético de Riachuelo"
    >
      <ellipse cx="140" cy="400" rx="90" ry="12" fill="var(--ink)" opacity="0.1" />

      {/* legs */}
      <path d="M120 280 L100 380 L80 410" fill="none" stroke="var(--teal)" strokeWidth="14" strokeLinecap="round" />
      <path d="M160 280 L185 380 L210 405" fill="none" stroke="var(--teal)" strokeWidth="14" strokeLinecap="round" />
      <circle cx="100" cy="380" r="9" fill="var(--teal-deep)" />
      <circle cx="185" cy="380" r="9" fill="var(--teal-deep)" />

      {/* body */}
      <path
        d="M90 180 C70 220 80 270 130 290 C175 305 215 280 210 230 C206 195 175 165 135 165 C115 165 100 170 90 180 Z"
        fill="var(--rust-red)"
        stroke="var(--rust-red-deep)"
        strokeWidth="6"
      />
      <path d="M120 200 C140 215 160 215 185 200" fill="none" stroke="var(--rust-red-deep)" strokeWidth="4" opacity="0.6" />

      {/* gear plate on chest */}
      <circle cx="150" cy="215" r="16" fill="var(--cream)" stroke="var(--teal-deep)" strokeWidth="4" />
      <circle cx="150" cy="215" r="5" fill="var(--signal-green)" />

      {/* neck */}
      <path
        d="M120 175 C95 150 85 110 105 75 C115 58 130 45 150 38"
        fill="none"
        stroke="var(--teal)"
        strokeWidth="20"
        strokeLinecap="round"
      />
      <path
        d="M120 175 C95 150 85 110 105 75 C115 58 130 45 150 38"
        fill="none"
        stroke="var(--teal-deep)"
        strokeWidth="20"
        strokeLinecap="round"
        opacity="0.15"
      />

      {/* head */}
      <ellipse cx="155" cy="35" rx="24" ry="20" fill="var(--rust-red)" stroke="var(--rust-red-deep)" strokeWidth="5" />
      <circle cx="163" cy="28" r="5" fill="var(--signal-green)" />

      {/* crane-hook beak */}
      <path
        d="M178 32 L250 20 C258 18 262 26 256 32 L240 40"
        fill="none"
        stroke="var(--rust-red-deep)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path d="M236 38 C236 50 248 54 254 46" fill="none" stroke="var(--teal-deep)" strokeWidth="6" strokeLinecap="round" />

      {/* wing detail */}
      <path
        d="M140 200 C155 210 175 215 195 205 C190 230 165 245 145 235 C135 230 135 212 140 200 Z"
        fill="var(--rust-red-deep)"
        opacity="0.5"
      />

      {/* rivets */}
      <circle cx="105" cy="240" r="3" fill="var(--cream)" />
      <circle cx="195" cy="250" r="3" fill="var(--cream)" />
      <circle cx="150" cy="270" r="3" fill="var(--cream)" />
    </svg>
  );
}
