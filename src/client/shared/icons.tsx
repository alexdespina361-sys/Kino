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

export const VolumeIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
);

export const MutedIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="m22 9-6 6m0-6 6 6" />
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

export const SearchIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

export const HomeIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
  </Icon>
);

export const GridIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  </Icon>
);

export const BackspaceIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6" />
  </Icon>
);

export const PlusIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const UserIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </Icon>
);

export const PencilIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />
  </Icon>
);

export const TrashIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const GlobeIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Icon>
);

export const LogoutIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
  </Icon>
);

export const GearIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
  </Icon>
);

export const PhoneIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="7" y="2" width="10" height="20" rx="2.5" />
    <path d="M11 18h2" />
  </Icon>
);

export const InfoIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5h.01" />
  </Icon>
);

export const LockIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15.5v2" />
  </Icon>
);

export const FilmIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </Icon>
);

export const ClockIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Icon>
);

export const UsersIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .7 3.5 2.6 3.5 5.6" />
  </Icon>
);

export const RefreshIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5" />
  </Icon>
);
