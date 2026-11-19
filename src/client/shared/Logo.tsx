export const APP_NAME = "Kino";

export const Logo = ({ className = "" }: { className?: string }) => (
  <span className={`logo ${className}`} role="img" aria-label={APP_NAME}>
    <img src="/branding/kino-beam.svg" width="291" height="147" alt="" aria-hidden="true" />
  </span>
);
