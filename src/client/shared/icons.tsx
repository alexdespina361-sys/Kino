import type { ReactNode, SVGProps } from "react";

/**
 * Inline SVG icons. Emoji and unicode symbols render differently on every TV browser (or not at all),
 * these look the same everywhere and take their colour and size from the surrounding text.
 */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

type Props = SVGProps<SVGSVGElement>;

export const PlayIcon = (props: Props) => (
  <Icon {...props}>
    {/* A triangle looks centred when its middle of mass, not its bounding box, sits in the middle: nudged ~1/12 of its width past centre. */}
    <path d="M7.4 5v14l11-7z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
  </Icon>
);

/** Circular arrow with "10" inside: back 10 seconds. */
export const Back10Icon = (props: Props) => (
  <Icon {...props}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    <text x="12.5" y="15.4" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">
      10
    </text>
  </Icon>
);

export const Forward10Icon = (props: Props) => (
  <Icon {...props}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    <text x="11.5" y="15.4" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">
      10
    </text>
  </Icon>
);

export const NextIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 5v14l10-7z" fill="currentColor" />
    <path d="M19 5v14" />
  </Icon>
);

export const PreviousIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M19 5v14L9 12z" fill="currentColor" />
    <path d="M5 5v14" />
  </Icon>
);

export const SubtitlesIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 11h3M12 11h5M7 15h5M14 15h3" />
  </Icon>
);

export const FullscreenIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </Icon>
);

export const StopIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </Icon>
);

export const CloseIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const CheckIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const TvIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);

export const LinkIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);

export const ClipboardIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </Icon>
);

export const MoreIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" />
  </Icon>
);

/** A viewfinder: the four corners of a frame with a line through it. */
export const ScanIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10" />
  </Icon>
);

export const ListIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);

export const ChevronIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
