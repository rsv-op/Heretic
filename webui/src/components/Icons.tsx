import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 20,
  height: 20,
  ...props,
});

export const Sigil = (props: IconProps) => (
  <svg {...base(props)} strokeWidth={1.3}>
    <path d="M12 2.6 4.4 6.9v9.1L12 21.4l7.6-5.4V6.9L12 2.6Z" />
    <path d="M12 7.2v9.6M8.4 9.3v5.4M15.6 9.3v5.4" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const Waveform = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 12h1.6M7 7.5v9M10.5 4.5v15M14 8.5v7M17.5 6v12M21 11h-.8" />
  </svg>
);

export const Bug = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8.5 6.5a3.5 3.5 0 0 1 7 0" />
    <rect x="7.5" y="6.5" width="9" height="12" rx="4.5" />
    <path d="M7.5 11H4M20 11h-3.5M7.5 15.5 4.6 17M16.5 15.5l2.9 1.5M12 9v7" />
  </svg>
);

export const FolderScan = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.4l1.8 2.2h8.4a1.7 1.7 0 0 1 1.7 1.7v7.4a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.2Z" />
    <path d="M9 13.6h6M10.6 16.2h2.8" />
  </svg>
);

export const Branch = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="7" cy="5.5" r="2" />
    <circle cx="7" cy="18.5" r="2" />
    <circle cx="17" cy="9" r="2" />
    <path d="M7 7.5v9M17 11c0 3.2-2.6 4-5.2 4.6" />
  </svg>
);

export const Gate = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3 5 6v5.4c0 4 2.9 7.6 7 9.6 4.1-2 7-5.6 7-9.6V6l-7-3Z" />
    <path d="M9.3 12.2 11.3 14l3.6-3.9" />
  </svg>
);

export const Ledger = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5.5 4.5h11a2 2 0 0 1 2 2v13H7.5a2 2 0 0 1-2-2v-13Z" />
    <path d="M5.5 4.5v13M9 8.5h6M9 12h6M9 15.5h3.5" />
  </svg>
);

export const Droid = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 10.5h12v6.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 16.7v-6.2Z" />
    <path d="M8.4 10.5V8.2A3.6 3.6 0 0 1 12 4.6a3.6 3.6 0 0 1 3.6 3.6v2.3" />
    <path d="M9.2 6.1 8 4.4M14.8 6.1 16 4.4M3.6 12.4v3.4M20.4 12.4v3.4" />
    <circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="14" cy="14" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const Gauge = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="m12 17 4-5.4" />
    <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const Terminal = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="m7 10 2.6 2.4L7 14.8M12.6 15h4.2" />
  </svg>
);

export const Search = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6" />
    <path d="m15.6 15.6 4 4" />
  </svg>
);

export const Plus = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);

export const Trash = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.8 7h14.4M9.5 7V5.2h5V7M6.6 7l.9 12h9l.9-12M10.4 10.6v5.6M13.6 10.6v5.6" />
  </svg>
);

export const Pencil = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m4.8 19.2.9-3.6L15.9 5.4a1.7 1.7 0 0 1 2.4 0l.3.3a1.7 1.7 0 0 1 0 2.4L8.4 18.3l-3.6.9Z" />
    <path d="m14.6 6.8 2.6 2.6" />
  </svg>
);

export const Check = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m5 12.8 4.4 4.2L19 6.8" />
  </svg>
);

export const Cross = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
  </svg>
);

export const Chevron = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </svg>
);

export const Download = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4v10.5M7.8 10.8 12 15l4.2-4.2M4.8 19h14.4" />
  </svg>
);

export const Play = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 5.6 18 12 8 18.4V5.6Z" />
  </svg>
);

export const Mic = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="9.2" y="3.4" width="5.6" height="10.4" rx="2.8" />
    <path d="M5.8 11.6a6.2 6.2 0 0 0 12.4 0M12 17.8V21M9 21h6" />
  </svg>
);

export const Speaker = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.6 9.4h3L12 5.6v12.8L7.6 14.6h-3V9.4Z" />
    <path d="M15.4 9.6a3.4 3.4 0 0 1 0 4.8M17.8 7.2a6.8 6.8 0 0 1 0 9.6" />
  </svg>
);

export const Bolt = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M13.4 3 6 13.4h5l-1.4 7.6L18 10.4h-5.2L13.4 3Z" />
  </svg>
);

export const Lock = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="5" y="10.4" width="14" height="9.2" rx="2" />
    <path d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4M12 14v2.4" />
  </svg>
);

export const Logout = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M14.5 5.5H6.8v13h7.7M11 12h8.4M16.6 8.8 19.8 12l-3.2 3.2" />
  </svg>
);

export const Menu = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export const Copy = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15.4 6.2A2.2 2.2 0 0 0 13.2 4H6.2A2.2 2.2 0 0 0 4 6.2v7a2.2 2.2 0 0 0 2.2 2.2" />
  </svg>
);

export const Refresh = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M19.4 12a7.4 7.4 0 1 1-2.3-5.3" />
    <path d="M19.6 4.6v4.2h-4.2" />
  </svg>
);

export const Layers = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m12 3.6 8.4 4.2-8.4 4.2L3.6 7.8 12 3.6Z" />
    <path d="m3.6 12.4 8.4 4.2 8.4-4.2M3.6 16.6l8.4 4.2 8.4-4.2" />
  </svg>
);

export const Spark = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3.6 13.7 9l5.4 1.7-5.4 1.7L12 17.8 10.3 12.4 4.9 10.7 10.3 9 12 3.6Z" />
  </svg>
);

export const User = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="8.4" r="3.6" />
    <path d="M4.8 20c1.3-3.4 3.9-5 7.2-5s5.9 1.6 7.2 5" />
  </svg>
);

export const Settings = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M12 3.4v2.2M12 18.4v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1" />
  </svg>
);

export const Alert = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4.6 21 19.4H3L12 4.6Z" />
    <path d="M12 10v4M12 16.6v.6" />
  </svg>
);

export const Arrow = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.5 12h14M13.4 6.8 18.8 12l-5.4 5.2" />
  </svg>
);
