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

/** Two triangles pointing on: faster. */
export const FastForwardIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M3 5.5v13l8.5-6.5z" fill="currentColor" />
    <path d="M12.5 5.5v13L21 12z" fill="currentColor" />
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

export const ExitFullscreenIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
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

/** Two sheets, one over the other: copy. */
export const CopyIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

export const ChevronLeftIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M15 6l-6 6 6 6" />
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

/** A round button with a cross: empty the box (Delete takes one letter, this takes them all). */
export const ClearIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
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

export const BellIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
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
    {/* A cog, not a sun: six teeth whose tips and valleys follow two circles (radii 10 and 7.2), the hub a circle in the middle. */}
    <path d="M9.89 5.11L10.18 2.17A10 10 0 0 1 13.82 2.17L14.11 5.11A7.2 7.2 0 0 1 16.91 6.73L19.6 5.51A10 10 0 0 1 21.43 8.66L19.02 10.38A7.2 7.2 0 0 1 19.02 13.62L21.43 15.34A10 10 0 0 1 19.6 18.49L16.91 17.27A7.2 7.2 0 0 1 14.11 18.89L13.82 21.83A10 10 0 0 1 10.18 21.83L9.89 18.89A7.2 7.2 0 0 1 7.09 17.27L4.4 18.49A10 10 0 0 1 2.57 15.34L4.98 13.62A7.2 7.2 0 0 1 4.98 10.38L2.57 8.66A10 10 0 0 1 4.4 5.51L7.09 6.73A7.2 7.2 0 0 1 9.89 5.11Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

/** A phone upright, a little over three parts high to two wide (the first one drawn was one to two: it read as a ruler beside the menu's other icons). */
export const PhoneIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="5.5" y="3" width="13" height="18" rx="3" />
    <path d="M10.5 17.2h3" />
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

export const EyeIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.8 3.7M6.7 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
);

export const FilmIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </Icon>
);

/** A face with a wide grin: cartoons. */
export const CartoonIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9.5h.01M15 9.5h.01" />
    <path d="M7.8 13.5h8.4a4.2 4.2 0 0 1-8.4 0z" />
  </Icon>
);

/** A torii gate: anime. */
export const AnimeIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M2.5 5.5C6 7 9 7 12 7s6 0 9.5-1.5" />
    <path d="M5 11h14M7.5 7.5V21M16.5 7.5V21M12 7.5V11" />
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

/** A heart: friends. */
export const HeartIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </Icon>
);

export const RefreshIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5" />
  </Icon>
);

/** A star: an outline, or filled in for a title that has a rating. */
export const StarIcon = ({ filled, ...props }: Props & { filled?: boolean }) => (
  <Icon {...props}>
    <polygon points="12 2.5 15.1 8.8 22 9.8 17 14.6 18.2 21.5 12 18.2 5.8 21.5 7 14.6 2 9.8 8.9 8.8" {...(filled ? { fill: "currentColor" } : {})} />
  </Icon>
);

/* ---- the feedback: what kind it is, how a picture is added and marked ---- */

/** A bug: head, shell, six legs and two feelers. */
export const BugIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M9.2 7.4a2.8 2.8 0 0 1 5.6 0M8 3.6l1.6 1.9M16 3.6l-1.6 1.9" />
    <rect x="6.8" y="7.4" width="10.4" height="12.6" rx="5.2" />
    <path d="M12 7.6V20M6.8 12H3M17.2 12H21M7.2 16.6l-3 1.6M16.8 16.6l3 1.6M7.2 8.6 4.4 7M16.8 8.6 19.6 7" />
  </Icon>
);

export const WarningIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M12 3.4 2.6 19.6h18.8z" />
    <path d="M12 10v4.4M12 17.2h.01" />
  </Icon>
);

/** A spark: something that is there, made better. */
export const SparkleIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M10.5 4.5 12.4 10l5.6 1.9-5.6 1.9-1.9 5.6-1.9-5.6L3 11.9 8.6 10z" />
    <path d="M19 3.5v4M17 5.5h4M18.5 15.5v3.5M16.8 17.2h3.4" />
  </Icon>
);

/** A bulb: a new idea. */
export const BulbIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M9.4 18.2h5.2M10.2 21h3.6" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1 1.2 1 2v.4h5.2v-.4c0-.8.3-1.5 1-2A6 6 0 0 0 12 3z" />
  </Icon>
);

export const MessageIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <path d="M8 9h8M8 12.5h5" />
  </Icon>
);

export const QuestionIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.4 9.4a2.6 2.6 0 1 1 3.7 2.3c-.7.4-1.1 1-1.1 1.8M12 16.8h.01" />
  </Icon>
);

export const CameraIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 8h3l1.5-2.6h7L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.2" r="3.6" />
  </Icon>
);

export const ImageIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.6" cy="9.4" r="1.7" />
    <path d="M3.5 17l5-5 4 4 3-3 5 5" />
  </Icon>
);

export const PaperclipIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M20.5 11.6l-8.3 8.3a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.5 3.5 0 0 1 5 5L10 17.5a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7" />
  </Icon>
);

/** The four corners of what is on the screen, and a dot in the middle: a picture of the screen. */
export const ScreenshotIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
    <circle cx="12" cy="12" r="2.6" />
  </Icon>
);

/** The tools that mark a picture: a circle (drawn as an oval), an arrow, a box, a line by hand (the pencil), a word, a cover. */
export const OvalIcon = (props: Props) => (
  <Icon {...props}>
    <ellipse cx="12" cy="12" rx="9" ry="6.4" />
  </Icon>
);

export const ArrowIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 19 19 5M9 5h10v10" />
  </Icon>
);

export const BoxIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="4" y="5.5" width="16" height="13" rx="1.6" />
  </Icon>
);

export const TextIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 7V4.8h14V7M12 4.8v14.4M9 19.2h6" />
  </Icon>
);

/** A solid block: what covers the private part of a picture. */
export const CoverIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="4" y="6" width="16" height="12" rx="1.6" fill="currentColor" />
  </Icon>
);

export const UndoIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const RedoIcon = (props: Props) => (
  <Icon {...props}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const SendIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M21 3 10.4 13.6M21 3l-6.6 18-4-7.4L3 9.6z" />
  </Icon>
);

export const ShieldIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M12 3 4.6 6v5.6c0 4.4 3 7.9 7.4 9.4 4.4-1.5 7.4-5 7.4-9.4V6z" />
    <path d="m9 12 2.2 2.2L15.4 10" />
  </Icon>
);
