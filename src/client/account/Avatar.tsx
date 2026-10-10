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

/** The twelve pictures a profile can have: a face on a colour, drawn here so they are crisp at any size and cost no downloads. */
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
