import type { ReactNode } from "react";
import type { AvatarId } from "../../shared";
import { useT } from "../i18n";

/** Round dark eyes with a white glint, the shared look of the faces below. */
const Eye = ({ x, y, r = 4.2, colour = "#1d1d26" }: { x: number; y: number; r?: number; colour?: string }) => (
  <>
    <circle cx={x} cy={y} r={r} fill={colour} />
    <circle cx={x - r * 0.3} cy={y - r * 0.35} r={r * 0.32} fill="#fff" />
  </>
);

const Cheek = ({ x, y, colour = "#ff9fb0" }: { x: number; y: number; colour?: string }) => <circle cx={x} cy={y} r={5} fill={colour} opacity={0.65} />;

const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The pictures a profile can have: a face on a colour, drawn here so they are crisp at any size and cost no downloads. Twelve animals and creatures,
 * and twelve of the cinema and of what is watched there (the owner, 18 Nov: "more profile pictures, and more in theme").
 */
const ART: Record<AvatarId, { bg: string; art: ReactNode }> = {
  fox: {
    bg: "#ffb26b",
    art: (
      <>
        <path d="M14 12 L41 34 L17 56Z" fill="#d9531a" />
        <path d="M86 12 L59 34 L83 56Z" fill="#d9531a" />
        <path d="M21 26 L35 37 L22 47Z" fill="#2a1a14" />
        <path d="M79 26 L65 37 L78 47Z" fill="#2a1a14" />
        <path d="M50 88 C25 88 13 68 15 50 C28 40 38 36 50 36 C62 36 72 40 85 50 C87 68 75 88 50 88Z" fill="#f57c24" />
        <path d="M15 50 C20 70 34 82 50 82 C66 82 80 70 85 50 C73 60 62 64 50 64 C38 64 27 60 15 50Z" fill="#fff4e6" />
        <Eye x={36} y={53} colour="#2a1a14" />
        <Eye x={64} y={53} colour="#2a1a14" />
        <ellipse cx={50} cy={70} rx={5.5} ry={4} fill="#2a1a14" />
      </>
    ),
  },
  cat: {
    bg: "#8ecbff",
    art: (
      <>
        <path d="M17 17 L43 34 L19 54Z" fill="#8a8f99" />
        <path d="M83 17 L57 34 L81 54Z" fill="#8a8f99" />
        <path d="M22 28 L35 36 L23 46Z" fill="#f4a4b8" />
        <path d="M78 28 L65 36 L77 46Z" fill="#f4a4b8" />
        <ellipse cx={50} cy={58} rx={34} ry={29} fill="#a8adb7" />
        <path d="M50 31 v9 M41 33 l2 7 M59 33 l-2 7" stroke="#7b808b" strokeWidth={3} {...line} />
        <ellipse cx={37} cy={56} rx={4.2} ry={5.6} fill="#2d2f36" />
        <ellipse cx={63} cy={56} rx={4.2} ry={5.6} fill="#2d2f36" />
        <circle cx={35.8} cy={53.8} r={1.5} fill="#fff" />
        <circle cx={61.8} cy={53.8} r={1.5} fill="#fff" />
        <path d="M46 66 h8 l-4 5Z" fill="#f4a4b8" />
        <path d="M50 71 v3 M50 74 q-5 4 -9 1 M50 74 q5 4 9 1" stroke="#2d2f36" strokeWidth={2} {...line} />
        <path d="M13 60 h15 M14 69 l14 -3 M87 60 h-15 M86 69 l-14 -3" stroke="#fff" strokeWidth={1.8} {...line} />
      </>
    ),
  },
  panda: {
    bg: "#a8e6b8",
    art: (
      <>
        <circle cx={23} cy={27} r={12} fill="#22232b" />
        <circle cx={77} cy={27} r={12} fill="#22232b" />
        <circle cx={50} cy={56} r={35} fill="#fff" />
        <ellipse cx={36} cy={52} rx={8.5} ry={11} fill="#22232b" transform="rotate(-18 36 52)" />
        <ellipse cx={64} cy={52} rx={8.5} ry={11} fill="#22232b" transform="rotate(18 64 52)" />
        <circle cx={37.5} cy={51} r={3.2} fill="#fff" />
        <circle cx={62.5} cy={51} r={3.2} fill="#fff" />
        <circle cx={38} cy={51.4} r={1.5} fill="#22232b" />
        <circle cx={62} cy={51.4} r={1.5} fill="#22232b" />
        <ellipse cx={50} cy={67} rx={5.5} ry={3.8} fill="#22232b" />
        <path d="M50 70 v3 M43 75 q7 5 14 0" stroke="#22232b" strokeWidth={2} {...line} />
      </>
    ),
  },
  owl: {
    bg: "#c8b6ff",
    art: (
      <>
        <path d="M20 30 L33 18 L37 36Z" fill="#6e4529" />
        <path d="M80 30 L67 18 L63 36Z" fill="#6e4529" />
        <ellipse cx={50} cy={57} rx={34} ry={36} fill="#8f5d3a" />
        <ellipse cx={50} cy={72} rx={20} ry={18} fill="#ecd0a8" />
        <path d="M40 66 q3 -3 6 0 M54 66 q3 -3 6 0 M47 78 q3 -3 6 0" stroke="#c9a679" strokeWidth={2} {...line} />
        <circle cx={36} cy={48} r={13.5} fill="#fff" stroke="#6e4529" strokeWidth={3} />
        <circle cx={64} cy={48} r={13.5} fill="#fff" stroke="#6e4529" strokeWidth={3} />
        <Eye x={37} y={49} r={5.8} />
        <Eye x={63} y={49} r={5.8} />
        <path d="M44 57 H56 L50 69Z" fill="#f5a623" />
      </>
    ),
  },
  bear: {
    bg: "#ffd98a",
    art: (
      <>
        <circle cx={24} cy={27} r={12.5} fill="#98622f" />
        <circle cx={76} cy={27} r={12.5} fill="#98622f" />
        <circle cx={24} cy={27} r={6.5} fill="#d9a56b" />
        <circle cx={76} cy={27} r={6.5} fill="#d9a56b" />
        <circle cx={50} cy={57} r={35} fill="#b27a45" />
        <ellipse cx={50} cy={69} rx={16} ry={13} fill="#ecc89a" />
        <Eye x={36} y={51} colour="#2a1a14" />
        <Eye x={64} y={51} colour="#2a1a14" />
        <ellipse cx={50} cy={63} rx={6} ry={4.4} fill="#2a1a14" />
        <path d="M50 67 v5 M50 72 q-5 4 -9 0 M50 72 q5 4 9 0" stroke="#2a1a14" strokeWidth={2} {...line} />
      </>
    ),
  },
  rabbit: {
    bg: "#ffc1de",
    art: (
      <>
        <ellipse cx={36} cy={27} rx={9.5} ry={25} fill="#fff" transform="rotate(-8 36 27)" />
        <ellipse cx={64} cy={27} rx={9.5} ry={25} fill="#fff" transform="rotate(8 64 27)" />
        <ellipse cx={36} cy={29} rx={4.6} ry={17} fill="#f7a6c4" transform="rotate(-8 36 27)" />
        <ellipse cx={64} cy={29} rx={4.6} ry={17} fill="#f7a6c4" transform="rotate(8 64 27)" />
        <ellipse cx={50} cy={66} rx={31} ry={27} fill="#fff" />
        <Eye x={38} y={62} colour="#2a2a36" />
        <Eye x={62} y={62} colour="#2a2a36" />
        <Cheek x={29} y={72} colour="#ffc4da" />
        <Cheek x={71} y={72} colour="#ffc4da" />
        <ellipse cx={50} cy={70} rx={4.2} ry={3.2} fill="#f26fa0" />
        <path d="M50 73 v3 M50 76 q-4 3 -8 0 M50 76 q4 3 8 0" stroke="#7a5a68" strokeWidth={1.8} {...line} />
      </>
    ),
  },
  frog: {
    bg: "#b9f0c4",
    art: (
      <>
        <ellipse cx={50} cy={63} rx={37} ry={28} fill="#45c260" />
        <circle cx={32} cy={39} r={15} fill="#45c260" />
        <circle cx={68} cy={39} r={15} fill="#45c260" />
        <circle cx={32} cy={39} r={10.5} fill="#fff" />
        <circle cx={68} cy={39} r={10.5} fill="#fff" />
        <Eye x={33} y={40} r={5.6} />
        <Eye x={67} y={40} r={5.6} />
        <circle cx={44} cy={57} r={1.7} fill="#1f6b32" />
        <circle cx={56} cy={57} r={1.7} fill="#1f6b32" />
        <path d="M25 67 Q50 88 75 67" stroke="#1f6b32" strokeWidth={3.5} {...line} />
        <Cheek x={22} y={70} />
        <Cheek x={78} y={70} />
      </>
    ),
  },
  penguin: {
    bg: "#a6d8ff",
    art: (
      <>
        <ellipse cx={50} cy={58} rx={35} ry={37} fill="#27344f" />
        <ellipse cx={38} cy={48} rx={15} ry={17} fill="#fff" />
        <ellipse cx={62} cy={48} rx={15} ry={17} fill="#fff" />
        <ellipse cx={50} cy={73} rx={21} ry={17} fill="#fff" />
        <Eye x={40} y={48} />
        <Eye x={60} y={48} />
        <Cheek x={30} y={58} colour="#ffb4a0" />
        <Cheek x={70} y={58} colour="#ffb4a0" />
        <path d="M42 57 H58 L50 68Z" fill="#ffa21f" />
      </>
    ),
  },
  robot: {
    bg: "#d7dce6",
    art: (
      <>
        <path d="M50 28 V15" stroke="#667189" strokeWidth={4} {...line} />
        <circle cx={50} cy={13} r={5.5} fill="#ff5d6c" />
        <rect x={10} y={46} width={9} height={18} rx={3.5} fill="#667189" />
        <rect x={81} y={46} width={9} height={18} rx={3.5} fill="#667189" />
        <rect x={19} y={28} width={62} height={56} rx={13} fill="#8d99ae" />
        <rect x={27} y={37} width={46} height={30} rx={9} fill="#1f2a40" />
        <rect x={34} y={46} width={10} height={11} rx={3} fill="#4de1ff" />
        <rect x={56} y={46} width={10} height={11} rx={3} fill="#4de1ff" />
        <path d="M38 75 h24" stroke="#4a556c" strokeWidth={3} strokeDasharray="4 3" {...line} />
      </>
    ),
  },
  alien: {
    bg: "#2a2650",
    art: (
      <>
        <circle cx={14} cy={18} r={1.6} fill="#fff" opacity={0.85} />
        <circle cx={87} cy={24} r={1.4} fill="#fff" opacity={0.85} />
        <circle cx={81} cy={86} r={1.2} fill="#fff" opacity={0.7} />
        <circle cx={17} cy={82} r={1.3} fill="#fff" opacity={0.7} />
        <path d="M50 13 C75 13 87 34 83 55 C79 73 63 89 50 89 C37 89 21 73 17 55 C13 34 25 13 50 13Z" fill="#7be495" />
        <ellipse cx={35} cy={52} rx={9.5} ry={14} fill="#14111f" transform="rotate(-24 35 52)" />
        <ellipse cx={65} cy={52} rx={9.5} ry={14} fill="#14111f" transform="rotate(24 65 52)" />
        <circle cx={31.5} cy={46} r={2.4} fill="#fff" />
        <circle cx={68.5} cy={46} r={2.4} fill="#fff" />
        <path d="M41 73 Q50 78 59 73" stroke="#1c6b3a" strokeWidth={2.6} {...line} />
      </>
    ),
  },
  ghost: {
    bg: "#4b4478",
    art: (
      <>
        <path d="M23 87 V46 C23 28 35 15 50 15 C65 15 77 28 77 46 V87 L68 80 L59 87 L50 80 L41 87 L32 80Z" fill="#fff" />
        <ellipse cx={40} cy={47} rx={4.6} ry={6.4} fill="#26233d" />
        <ellipse cx={60} cy={47} rx={4.6} ry={6.4} fill="#26233d" />
        <ellipse cx={50} cy={63} rx={4.8} ry={6.2} fill="#26233d" />
        <Cheek x={32} y={58} colour="#ffb3c8" />
        <Cheek x={68} y={58} colour="#ffb3c8" />
      </>
    ),
  },
  monster: {
    bg: "#ffe08a",
    art: (
      <>
        <path d="M29 17 L41 38 L22 35Z" fill="#6a3fc0" />
        <path d="M71 17 L59 38 L78 35Z" fill="#6a3fc0" />
        <ellipse cx={50} cy={59} rx={35} ry={32} fill="#8e5bd6" />
        <circle cx={50} cy={48} r={15} fill="#fff" />
        <circle cx={50} cy={50} r={7.5} fill="#2d1b4e" />
        <circle cx={47} cy={47} r={2.6} fill="#fff" />
        <path d="M31 69 Q50 88 69 69Z" fill="#2d1b4e" />
        <path d="M37 71 H43 L40 78Z M46 74 H54 L50 81Z M57 71 H63 L60 78Z" fill="#fff" />
      </>
    ),
  },
  popcorn: {
    bg: "#ffd0c2",
    art: (
      <>
        <circle cx={27} cy={40} r={9} fill="#fff3c4" />
        <circle cx={33} cy={29} r={11} fill="#ffeeb0" />
        <circle cx={47} cy={22} r={12} fill="#fff3c4" />
        <circle cx={63} cy={26} r={12} fill="#ffeeb0" />
        <circle cx={73} cy={38} r={9.5} fill="#fff3c4" />
        <circle cx={41} cy={36} r={10} fill="#fff8dc" />
        <circle cx={57} cy={37} r={11} fill="#fff3c4" />
        <path d="M21 41 H79 L72 89 H28Z" fill="#fff" />
        <path d="M21 41 H31 L35 89 H28Z M41 41 H50 V89 H44Z M60 41 H69 L64 89 H58Z" fill="#e63946" />
        <path d="M79 41 H74 L68 89 H72Z" fill="#e63946" />
        <ellipse cx={50} cy={65} rx={18} ry={13} fill="#fff" />
        <Eye x={43} y={62} r={3.6} />
        <Eye x={57} y={62} r={3.6} />
        <Cheek x={37} y={69} />
        <Cheek x={63} y={69} />
        <path d="M45 69 Q50 74 55 69" stroke="#2a1a14" strokeWidth={2.2} {...line} />
      </>
    ),
  },
  clapper: {
    bg: "#ffe08a",
    art: (
      <>
        <rect x={17} y={43} width={66} height={43} rx={7} fill="#2b2d3a" />
        <g transform="rotate(-13 19 43)">
          <rect x={17} y={28} width={66} height={14} rx={4} fill="#2b2d3a" />
          <path d="M27 28 h10 l-7 14 h-10Z M46 28 h10 l-7 14 h-10Z M65 28 h10 l-7 14 h-10Z" fill="#fff" />
        </g>
        <rect x={17} y={43} width={66} height={9} fill="#3d4052" />
        <path d="M24 43 h9 l-6 9 h-9Z M43 43 h9 l-6 9 h-9Z M62 43 h9 l-6 9 h-9Z" fill="#fff" />
        <circle cx={38} cy={65} r={6.5} fill="#fff" />
        <circle cx={62} cy={65} r={6.5} fill="#fff" />
        <circle cx={39} cy={66} r={3.3} fill="#1d1d26" />
        <circle cx={61} cy={66} r={3.3} fill="#1d1d26" />
        <path d="M42 76 Q50 82 58 76" stroke="#fff" strokeWidth={2.6} {...line} />
      </>
    ),
  },
  reel: {
    bg: "#b8e0ff",
    art: (
      <>
        <circle cx={50} cy={52} r={37} fill="#4a4e69" />
        <circle cx={50} cy={52} r={31} fill="#6c7190" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((turn) => (
          <circle key={turn} cx={50} cy={27.5} r={5.6} fill="#b8e0ff" transform={`rotate(${turn} 50 52)`} />
        ))}
        <circle cx={50} cy={52} r={16.5} fill="#ffd98a" />
        <Eye x={44} y={50} r={3.4} />
        <Eye x={56} y={50} r={3.4} />
        <path d="M45 57 Q50 62 55 57" stroke="#2a1a14" strokeWidth={2.2} {...line} />
        <path d="M70 84 Q84 90 92 80" stroke="#4a4e69" strokeWidth={6} {...line} />
      </>
    ),
  },
  ticket: {
    bg: "#c8f0d0",
    art: (
      <g transform="rotate(-10 50 50)">
        <path d="M12 34 a5 5 0 0 1 5 -5 H83 a5 5 0 0 1 5 5 V43 a7 7 0 0 0 0 14 V66 a5 5 0 0 1 -5 5 H17 a5 5 0 0 1 -5 -5 V57 a7 7 0 0 0 0 -14Z" fill="#ff6b6b" />
        <path d="M66 33 V67" stroke="#fff" strokeWidth={2.4} strokeDasharray="3 4.5" {...line} />
        <path d="M77 43 l1.9 4.2 l4.6 0.5 l-3.4 3.1 l0.9 4.5 l-4 -2.3 l-4 2.3 l0.9 -4.5 l-3.4 -3.1 l4.6 -0.5Z" fill="#ffe066" />
        <Eye x={32} y={47} r={3.8} />
        <Eye x={48} y={47} r={3.8} />
        <Cheek x={25} y={55} colour="#ffd0d0" />
        <Cheek x={55} y={55} colour="#ffd0d0" />
        <path d="M35 56 Q40 61 45 56" stroke="#2a1a14" strokeWidth={2.2} {...line} />
      </g>
    ),
  },
  camera: {
    bg: "#ffd0e8",
    art: (
      <>
        <circle cx={32} cy={30} r={13} fill="#6c7190" />
        <circle cx={56} cy={30} r={13} fill="#6c7190" />
        <circle cx={32} cy={30} r={4.5} fill="#ffd0e8" />
        <circle cx={56} cy={30} r={4.5} fill="#ffd0e8" />
        <path d="M66 54 L87 43 V77 L66 66Z" fill="#6c7190" />
        <rect x={17} y={41} width={51} height={38} rx={8} fill="#4a4e69" />
        <circle cx={34} cy={57} r={6.5} fill="#fff" />
        <circle cx={52} cy={57} r={6.5} fill="#fff" />
        <circle cx={35} cy={58} r={3.3} fill="#1d1d26" />
        <circle cx={51} cy={58} r={3.3} fill="#1d1d26" />
        <path d="M37 69 Q43 74 49 69" stroke="#fff" strokeWidth={2.6} {...line} />
        <circle cx={62} cy={47} r={2.2} fill="#ff5d6c" />
      </>
    ),
  },
  star: {
    bg: "#2a2650",
    art: (
      <>
        <circle cx={13} cy={20} r={1.6} fill="#fff" opacity={0.85} />
        <circle cx={88} cy={18} r={1.3} fill="#fff" opacity={0.8} />
        <circle cx={84} cy={88} r={1.4} fill="#fff" opacity={0.7} />
        <circle cx={12} cy={78} r={1.2} fill="#fff" opacity={0.7} />
        <path d="M50 14 L60 38.2 L86.1 40.3 L66.2 57.3 L72.3 82.7 L50 69 L27.7 82.7 L33.8 57.3 L13.9 40.3 L40 38.2Z" fill="#ffd23f" stroke="#ffd23f" strokeWidth={6} strokeLinejoin="round" />
        <Eye x={43} y={50} r={3.6} colour="#3a2a05" />
        <Eye x={57} y={50} r={3.6} colour="#3a2a05" />
        <Cheek x={36} y={57} colour="#ffab5c" />
        <Cheek x={64} y={57} colour="#ffab5c" />
        <path d="M45 58 Q50 63 55 58" stroke="#3a2a05" strokeWidth={2.2} {...line} />
      </>
    ),
  },
  ninja: {
    bg: "#ffcf99",
    art: (
      <>
        <path d="M80 39 l14 -7 l-3 10Z M80 42 l13 7 l-9 3Z" fill="#c92a37" />
        <circle cx={50} cy={55} r={35} fill="#2b2d3a" />
        <path d="M19 47 Q50 37 81 47 Q83 56 80 62 Q50 69 20 62 Q17 56 19 47Z" fill="#f6d2b0" />
        <Eye x={37} y={54} />
        <Eye x={63} y={54} />
        <path d="M29 46 l12 4 M71 46 l-12 4" stroke="#2b2d3a" strokeWidth={3.4} {...line} />
        <path d="M16 39 Q50 25 84 39 L83 46 Q50 33 17 46Z" fill="#e63946" />
      </>
    ),
  },
  wizard: {
    bg: "#bfe3ff",
    art: (
      <>
        <circle cx={50} cy={60} r={23} fill="#f6d2b0" />
        <path d="M27 60 Q28 93 50 95 Q72 93 73 60 Q62 71 50 71 Q38 71 27 60Z" fill="#fff" />
        <Eye x={41} y={57} r={3.6} />
        <Eye x={59} y={57} r={3.6} />
        <path d="M50 69 q-7 -4 -12 2 M50 69 q7 -4 12 2" stroke="#e3e6ef" strokeWidth={4.5} {...line} />
        <circle cx={50} cy={65} r={3.6} fill="#eab590" />
        <path d="M52 5 L74 45 H26Z" fill="#5b3fc0" />
        <ellipse cx={50} cy={45} rx={36} ry={7.5} fill="#4a31a3" />
        <path d="M51 20 l1.7 3.8 l4.1 0.4 l-3.1 2.8 l0.9 4 l-3.6 -2.1 l-3.6 2.1 l0.9 -4 l-3.1 -2.8 l4.1 -0.4Z" fill="#ffe066" />
        <circle cx={62} cy={36} r={1.8} fill="#ffe066" />
        <circle cx={40} cy={35} r={1.4} fill="#ffe066" />
      </>
    ),
  },
  astronaut: {
    bg: "#1f3b5c",
    art: (
      <>
        <circle cx={14} cy={16} r={1.5} fill="#fff" opacity={0.85} />
        <circle cx={88} cy={22} r={1.3} fill="#fff" opacity={0.8} />
        <circle cx={85} cy={88} r={1.3} fill="#fff" opacity={0.7} />
        <circle cx={11} cy={84} r={1.4} fill="#fff" opacity={0.7} />
        <path d="M50 17 V8" stroke="#c3c9d6" strokeWidth={3.5} {...line} />
        <circle cx={50} cy={7} r={4} fill="#ff5d6c" />
        <rect x={8} y={46} width={9} height={16} rx={3.5} fill="#c3c9d6" />
        <rect x={83} y={46} width={9} height={16} rx={3.5} fill="#c3c9d6" />
        <circle cx={50} cy={53} r={37} fill="#f1f3f8" />
        <rect x={22} y={33} width={56} height={40} rx={19} fill="#27344f" />
        <ellipse cx={50} cy={56} rx={20} ry={14.5} fill="#f6d2b0" />
        <Eye x={42} y={54} r={3.6} />
        <Eye x={58} y={54} r={3.6} />
        <Cheek x={35} y={61} />
        <Cheek x={65} y={61} />
        <path d="M45 62 Q50 67 55 62" stroke="#2a1a14" strokeWidth={2.2} {...line} />
        <path d="M30 43 q7 -6 16 -6" stroke="#fff" strokeWidth={3} opacity={0.55} {...line} />
      </>
    ),
  },
  pirate: {
    bg: "#a8e6e0",
    art: (
      <>
        <path d="M78 44 l14 1 l-9 9Z" fill="#c92a37" />
        <circle cx={50} cy={59} r={31} fill="#f6d2b0" />
        <circle cx={19} cy={66} r={4.5} fill="none" stroke="#f5b82e" strokeWidth={2.6} />
        <path d="M18 51 Q50 12 82 51 Q50 39 18 51Z" fill="#e63946" />
        <circle cx={38} cy={36} r={2.2} fill="#fff" />
        <circle cx={52} cy={31} r={2.2} fill="#fff" />
        <circle cx={66} cy={37} r={2.2} fill="#fff" />
        <path d="M21 47 L80 66" stroke="#2b2d3a" strokeWidth={3} {...line} />
        <circle cx={38} cy={58} r={8.5} fill="#2b2d3a" />
        <Eye x={63} y={58} />
        <Cheek x={69} y={68} />
        <path d="M40 74 Q51 83 62 73" stroke="#2a1a14" strokeWidth={2.6} {...line} />
      </>
    ),
  },
  vampire: {
    bg: "#c9b8e8",
    art: (
      <>
        <path d="M18 96 L33 68 L50 86 L67 68 L82 96Z" fill="#b3122b" />
        <path d="M21 58 l-9 -10 l7 19Z M79 58 l9 -10 l-7 19Z" fill="#e9eef5" />
        <circle cx={50} cy={57} r={30} fill="#e9eef5" />
        <path d="M20 54 Q18 21 50 21 Q82 21 80 54 Q70 36 50 47 Q30 36 20 54Z" fill="#1d1d26" />
        <Eye x={39} y={58} colour="#b3122b" />
        <Eye x={61} y={58} colour="#b3122b" />
        <path d="M32 50 l11 3 M68 50 l-11 3" stroke="#1d1d26" strokeWidth={2.6} {...line} />
        <path d="M40 69 Q50 80 60 69Z" fill="#5a0f1e" />
        <path d="M43.5 70.2 l2.2 5.4 l2.2 -4.6Z M52.1 71 l2.2 4.6 l2.2 -5.4Z" fill="#fff" />
      </>
    ),
  },
  dragon: {
    bg: "#ffe3a3",
    art: (
      <>
        <path d="M31 36 L23 11 L42 30Z M69 36 L77 11 L58 30Z" fill="#e8963a" />
        <path d="M43 31 L50 17 L57 31Z" fill="#2a9d62" />
        <ellipse cx={50} cy={58} rx={33} ry={29} fill="#3fbf7f" />
        <ellipse cx={50} cy={72} rx={19} ry={13} fill="#8be3b4" />
        <circle cx={36} cy={50} r={8} fill="#ffe066" />
        <circle cx={64} cy={50} r={8} fill="#ffe066" />
        <ellipse cx={36} cy={50} rx={2.4} ry={6} fill="#1d1d26" />
        <ellipse cx={64} cy={50} rx={2.4} ry={6} fill="#1d1d26" />
        <circle cx={44} cy={69} r={2} fill="#1f6b45" />
        <circle cx={56} cy={69} r={2} fill="#1f6b45" />
        <path d="M40 77 Q50 83 60 77" stroke="#1f6b45" strokeWidth={2.6} {...line} />
        <Cheek x={24} y={64} colour="#ffb38a" />
        <Cheek x={76} y={64} colour="#ffb38a" />
      </>
    ),
  },
};

/** One profile picture. It is as big as the text around it (1em), so a parent sets the size with `font-size`. */
export function Avatar({ id, className = "" }: { id: AvatarId; className?: string }) {
  const t = useT();
  const { bg, art } = ART[id];
  return (
    <svg className={`avatar ${className}`.trim()} viewBox="0 0 100 100" role="img" aria-label={t(`avatar.${id}`)} data-avatar={id}>
      <rect width={100} height={100} fill={bg} />
      {art}
    </svg>
  );
}
