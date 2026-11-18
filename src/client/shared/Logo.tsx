export const APP_NAME = "Kino";

export const Logo = ({ className = "" }: { className?: string }) => (
  <span className={`logo ${className}`} role="img" aria-label={APP_NAME}>
    <img src="/branding/kino-cat-off.svg" width="269" height="115" alt="" aria-hidden="true" />
  </span>
);
